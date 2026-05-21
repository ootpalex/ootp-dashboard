// ============================================================================
// STRENGTH — Positional strength (slot-weighted), org need, league percentiles
// ============================================================================
// Each position's score is a SLOT-WEIGHTED sum of its depth chart's WAR — the
// starter dominates, each depth slot counts less, and below-replacement players
// count NEGATIVE (no clamp) — so an elite starter beats a deep-but-mediocre
// group AND a steep drop-off into negative depth is penalized, not hidden.
// Slot weights are the empirical playing-time shares in SLOT_SHARES (constants).
//
// Two views, computed together:
//   now  — 40-man pool; the starter slot is filled from the MLB-ACTIVE roster,
//          depth from the rest of the 40-man (so a 40-man AAA stud shows as the
//          real next-man-up). Value = current WAR. This is the big-league squad.
//   farm — MiLB-only players (meta.lev !== "MLB"); value = FV (calcFutureValue:
//          upside for under-27s, = current WAR for 27+). This is the pipeline
//          behind the MLB club, in isolation.
//
// Multi-position players are anchored to one best position via a spectrum
// cascade (hardest positions first), counted once. Pitchers are assigned to SP
// or RP by best role (pickPitcherRole), counted once.
//
// The engine also returns the contributing players per view/position (for the
// Org Overview drill-down) and the playing-time-weighted age of the NOW core
// per position (coreAge — surfaces an aging MLB core without a separate flag).
import { parseCSVBoolean } from "./helpers.js";
import { getWar, getWarP, getSpWar, getRpWar, isCurrentlyEligible, pickPitcherRole } from "./accessors.js";
import { calcFutureValue } from "./futureValue.js";
import { SLOT_SHARES, DEF_SPECTRUM_POT, POT_DISPLAY_POS } from "./constants.js";

// Field positions scored for hitters (no DH) and the full set of scored
// positions (field positions + SP + RP).
const HIT_POSITIONS = DEF_SPECTRUM_POT;
const STRENGTH_POS = POT_DISPLAY_POS;

const isActive = (p) => p.meta?.act ?? parseCSVBoolean(p.ACT);
const isOn40 = (p) => p.meta?.on40 ?? parseCSVBoolean(p.ON40);
const isMLBLevel = (p) => (p.meta?.lev ?? p.Lev) === "MLB";
const hitWeights = (pos) => SLOT_SHARES.hit[pos.toLowerCase()] || [1];

// Slot-weighted sum: weights[k] * values[k]. Negatives are NOT clamped — a
// below-replacement player (a steep drop-off in a position's depth) drags the
// score down, which is the point.
function slotWeighted(values, weights) {
  let s = 0;
  for (let k = 0; k < values.length && k < weights.length; k++) {
    s += weights[k] * (values[k] ?? 0);
  }
  return s;
}

// Future WAR at a position: FV blend of current + potential (= current when
// matured / no potential). null when the player has no current value there.
function futureWarAt(h, pos, cs) {
  const cur = getWar(h, pos);
  if (cur == null) return null;
  const pot = getWarP(h, pos);
  return pot == null ? cur : calcFutureValue(cur, pot, h._age, cs);
}

// Slotting for hitters, in stages:
//   STAGE 1 — the score-bearing assignment, positive values only:
//     • starters (slot 0) in DEFENSIVE-SPECTRUM order (hardest first: C, SS,
//       CF, 2B, 3B, LF, RF, 1B) so a premium position claims its best eligible
//       player before an easier one can pull him away — an SS-capable bat
//       anchors SS rather than padding 2B (where he may rate higher). Now mode
//       restricts the starter to the active pool.
//     • depth (slots ≥1) credit-greedy: each remaining player fills the open
//       slot (any eligible pos) adding the most credit = slot-weight × value,
//       so a flexible backup lands where it earns the most (not forced down the
//       spectrum). This keeps the flexibility the cascade lacked at depth.
//   STAGE 2 — populate the leftover slots with ≤0-value players (anchored by
//     VALUE, not weight × value — which would flee a negative to the shallowest
//     slot of a wrong position). Their negatives now COUNT in the score, so a
//     position whose only options are below replacement is penalized — that's
//     the steep-drop-off signal, not hidden.
// Returns { [pos]: [{ player, val }] }.
function assignHitters(hitters, valueFn, starterPred) {
  const claimed = {};
  HIT_POSITIONS.forEach((pos) => { claimed[pos] = []; });
  const used = new Set();
  const depthOf = (pos) => hitWeights(pos).length;

  // Precompute (player, pos, value) candidates once for every position the
  // player can play NOW — isCurrentlyEligible (current rating ≥ 50 or ≥ 75% of
  // potential), not isEligible (which includes potential-only positions a player
  // has never actually played, e.g. a 3B with a phantom 2B value from his bat).
  const cands = [];
  for (const h of hitters) {
    for (const pos of HIT_POSITIONS) {
      if (!isCurrentlyEligible(h, pos)) continue;
      const v = valueFn(h, pos);
      if (v != null) cands.push({ player: h, pos, v });
    }
  }

  // STAGE 1 — positive, score-bearing assignment.
  // Phase 1 — starters (slot 0), in DEFENSIVE-SPECTRUM order (hardest first).
  // Each position claims its best available eligible player by value at that
  // position (= credit, since the slot-0 weight is a per-position constant), so
  // a premium position is anchored before an easier one can pull the player
  // away. Now mode restricts to the active pool; a position with no eligible
  // active starter is filled later (depth or stage 2).
  for (const pos of HIT_POSITIONS) {
    let best = null;
    for (const c of cands) {
      if (c.pos !== pos || c.v <= 0) continue;
      if (used.has(c.player.ID)) continue;
      if (starterPred && !starterPred(c.player)) continue;
      if (!best || c.v > best.v) best = c;
    }
    if (best) { claimed[pos].push({ player: best.player, val: best.v }); used.add(best.player.ID); }
  }

  // Phase 2 — depth (slots ≥1) + any unfilled starters, credit-greedy over any
  // positive player: pick the unused candidate maximizing weight × value at its
  // next open slot, so a flexible backup lands where it earns the most credit.
  const pickBestCredit = () => {
    let best = null;
    for (const c of cands) {
      if (c.v <= 0) continue;
      if (used.has(c.player.ID)) continue;
      const slotIdx = claimed[c.pos].length;
      if (slotIdx >= depthOf(c.pos)) continue;
      const w = hitWeights(c.pos)[slotIdx] ?? 0;
      if (w <= 0) continue;
      const credit = w * c.v;
      if (!best || credit > best.credit) best = { player: c.player, pos: c.pos, val: c.v, credit };
    }
    return best;
  };
  while (true) {
    const best = pickBestCredit();
    if (!best) break;
    claimed[best.pos].push({ player: best.player, val: best.val });
    used.add(best.player.ID);
  }

  // STAGE 2 — populate the depth chart with the leftover (≤0-value, or
  // positive-but-no-open-slot) players, so a position whose only options are
  // below replacement shows who mans it AND is penalized for it (their negatives
  // count in the score — the steep-drop-off signal). Anchor each leftover to his
  // BEST-VALUE eligible open slot — NOT weight × value, which for a negative
  // value perversely prefers the shallowest slot and would scatter a
  // below-replacement catcher into a corner-OF/1B depth slot. Fill empty STARTER
  // slots first so no manned position reads empty.
  const pickBestValue = (starterOnly) => {
    let best = null;
    for (const c of cands) {
      if (used.has(c.player.ID)) continue;
      const slotIdx = claimed[c.pos].length;
      if (slotIdx >= depthOf(c.pos)) continue;
      if (starterOnly && slotIdx !== 0) continue;
      if (!best || c.v > best.v) best = { player: c.player, pos: c.pos, val: c.v };
    }
    return best;
  };
  for (const starterOnly of [true, false]) {
    while (true) {
      const best = pickBestValue(starterOnly);
      if (!best) break;
      claimed[best.pos].push({ player: best.player, val: best.val });
      used.add(best.player.ID);
    }
  }
  return claimed;
}

// Assignment of role candidates to SP/RP slots, each player used once.
// cands: [{ player, role: "sp"|"rp", v }]. Two stages mirror assignHitters:
//   Stage 1 — positive credit-greedy: each arm fills the SP/RP slot adding the
//     most credit = weight × WAR; surplus starters spill to RP.
//   Stage 2 — value-anchored fill of the leftover (≤0) arms into their
//     best-value role's next open slot (not weight × value, which would flee a
//     negative arm to a deep low-weight slot and hide a thin rotation/bullpen).
//     Their negatives now count in the score.
function greedyRoles(cands) {
  const sp = [], rp = [];
  const used = new Set();
  const curve = (role) => (role === "sp" ? SLOT_SHARES.sp : SLOT_SHARES.rp);
  const depthOf = (role) => curve(role).length;
  while (true) {
    let best = null;
    for (const c of cands) {
      if (c.v <= 0) continue;
      if (used.has(c.player.ID)) continue;
      const arr = c.role === "sp" ? sp : rp;
      const w = curve(c.role)[arr.length] ?? 0;
      if (w <= 0) continue;
      const credit = w * c.v;
      if (!best || credit > best.credit) best = { ...c, credit };
    }
    if (!best) break;
    (best.role === "sp" ? sp : rp).push({ player: best.player, val: best.v });
    used.add(best.player.ID);
  }
  while (true) {
    let best = null;
    for (const c of cands) {
      if (used.has(c.player.ID)) continue;
      const arr = c.role === "sp" ? sp : rp;
      if (arr.length >= depthOf(c.role)) continue;
      if (!best || c.v > best.v) best = c;
    }
    if (!best) break;
    (best.role === "sp" ? sp : rp).push({ player: best.player, val: best.v });
    used.add(best.player.ID);
  }
  return { sp, rp };
}

// Pitcher SP/RP buckets.
//   now  — credit-greedy: each pitcher can fill SP slots (current SP WAR, if
//          SP-eligible) and/or RP slots (current RP WAR); assigned wherever the
//          marginal credit is highest, counted once. Surplus starters spill to RP.
//          WAR is cross-role-comparable, so no scaling is needed.
//   farm — strict eligibility classes: SP = SP-eligible prospects valued as
//          starters (SP FV), RP = RP-only prospects valued as relievers (RP FV).
//          No cross-assignment — a starter prospect never pads the bullpen.
function pitcherBuckets(pitchers, mode, cs) {
  if (mode === "farm") {
    const spCands = [], rpCands = [];
    for (const p of pitchers) {
      const spElig = (p.starter ?? parseCSVBoolean(p.Starter)) || (p.starterP ?? parseCSVBoolean(p["Starter P"]));
      const r = pickPitcherRole(p, null, cs, spElig ? "sp" : "rp");
      if (r.fv != null) (spElig ? spCands : rpCands).push({ player: p, val: r.fv });
    }
    spCands.sort((a, b) => b.val - a.val);
    rpCands.sort((a, b) => b.val - a.val);
    return { sp: spCands.slice(0, SLOT_SHARES.sp.length), rp: rpCands.slice(0, SLOT_SHARES.rp.length) };
  }
  // now
  const cands = [];
  for (const p of pitchers) {
    const sv = getSpWar(p);   // null when not SP-eligible
    if (sv != null) cands.push({ player: p, role: "sp", v: sv });
    const rv = getRpWar(p);
    if (rv != null) cands.push({ player: p, role: "rp", v: rv });
  }
  return greedyRoles(cands);
}

// Attach the slot weight applied to each contributor (for the drill-down).
const withWeights = (contribs, weights) =>
  contribs.map((c, k) => ({ player: c.player, val: c.val, weight: weights[k] ?? 0 }));

// Playing-time-weighted age of a position's contributors (the "core age").
function weightedAge(contribs, weights) {
  let wsum = 0, ageSum = 0;
  contribs.forEach((c, k) => {
    const w = weights[k] ?? 0;
    const age = c.player._age;
    if (age != null) { ageSum += w * age; wsum += w; }
  });
  return wsum > 0 ? ageSum / wsum : null;
}

export function calcPositionalStrength(hitters, pitchers, teams, curveSettings = null) {
  const teamScores = {};
  const contributors = {};
  const coreAge = {};

  teams.forEach((team) => {
    const th = hitters.filter((h) => (h.meta?.org ?? h.ORG) === team);
    const tp = pitchers.filter((p) => (p.meta?.org ?? p.ORG) === team);
    teamScores[team] = { now: {}, farm: {} };
    contributors[team] = { now: {}, farm: {} };
    coreAge[team] = {};

    // NOW — 40-man pool, starter from MLB-active, value = current WAR.
    const nowH = assignHitters(th.filter(isOn40), (h, pos) => getWar(h, pos), isActive);
    const nowP = pitcherBuckets(tp.filter(isOn40), "now", curveSettings);
    // FARM — MiLB-only pool, value = FV.
    const farmH = assignHitters(th.filter((h) => !isMLBLevel(h)), (h, pos) => futureWarAt(h, pos, curveSettings), null);
    const farmP = pitcherBuckets(tp.filter((p) => !isMLBLevel(p)), "farm", curveSettings);

    HIT_POSITIONS.forEach((pos) => {
      const w = hitWeights(pos);
      const nc = nowH[pos] || [];
      const fc = farmH[pos] || [];
      teamScores[team].now[pos] = slotWeighted(nc.map((c) => c.val), w);
      teamScores[team].farm[pos] = slotWeighted(fc.map((c) => c.val), w);
      contributors[team].now[pos] = withWeights(nc, w);
      contributors[team].farm[pos] = withWeights(fc, w);
      coreAge[team][pos] = weightedAge(nc, w);
    });

    const spN = nowP.sp.slice(0, SLOT_SHARES.sp.length);
    const rpN = nowP.rp.slice(0, SLOT_SHARES.rp.length);
    const spF = farmP.sp.slice(0, SLOT_SHARES.sp.length);
    const rpF = farmP.rp.slice(0, SLOT_SHARES.rp.length);
    teamScores[team].now.SP = slotWeighted(spN.map((c) => c.val), SLOT_SHARES.sp);
    teamScores[team].now.RP = slotWeighted(rpN.map((c) => c.val), SLOT_SHARES.rp);
    teamScores[team].farm.SP = slotWeighted(spF.map((c) => c.val), SLOT_SHARES.sp);
    teamScores[team].farm.RP = slotWeighted(rpF.map((c) => c.val), SLOT_SHARES.rp);
    contributors[team].now.SP = withWeights(spN, SLOT_SHARES.sp);
    contributors[team].now.RP = withWeights(rpN, SLOT_SHARES.rp);
    contributors[team].farm.SP = withWeights(spF, SLOT_SHARES.sp);
    contributors[team].farm.RP = withWeights(rpF, SLOT_SHARES.rp);
    coreAge[team].SP = weightedAge(spN, SLOT_SHARES.sp);
    coreAge[team].RP = weightedAge(rpN, SLOT_SHARES.rp);
  });

  const zScores = { now: {}, farm: {} };
  const ranks = { now: {}, farm: {} };
  ["now", "farm"].forEach((mode) => {
    STRENGTH_POS.forEach((pos) => {
      const vals = teams.map((t) => teamScores[t][mode][pos] ?? 0);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const std = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length) || 1;
      const sorted = [...teams].sort((a, b) => (teamScores[b][mode][pos] ?? 0) - (teamScores[a][mode][pos] ?? 0));
      teams.forEach((team) => {
        if (!zScores[mode][team]) zScores[mode][team] = {};
        if (!ranks[mode][team]) ranks[mode][team] = {};
        zScores[mode][team][pos] = ((teamScores[team][mode][pos] ?? 0) - mean) / std;
        ranks[mode][team][pos] = sorted.indexOf(team) + 1;
      });
    });
  });

  return { teamScores, zScores, ranks, contributors, coreAge };
}

// Org positional need from strength z-scores: 0 at/above league average, growing
// as a position weakens. `mode` picks the lens — "now" (default) = MLB-squad
// weakness; "farm" = pipeline weakness. Scout passes its toggle. Scaled
// downstream by SMART_RANK_TUNING.ORG_NEED_BONUS_SCALE.
export function calcOrgNeed(team, strength, mode = "now") {
  const z = strength.zScores?.[mode]?.[team] || {};
  const needs = {};
  STRENGTH_POS.forEach((pos) => {
    needs[pos] = Math.max(0, -(z[pos] ?? 0));
  });
  return needs;
}

export const leaguePercentile = (v, arr) => {
  if (v == null) return null;
  const valid = arr.filter(x => x != null && !isNaN(x));
  if (valid.length === 0) return 50;
  return Math.round(valid.filter(x => x <= v).length / valid.length * 100);
};

export const leagueScoutScale = (v, arr) => {
  if (v == null) return null;
  const valid = arr.filter(x => x != null && !isNaN(x));
  if (valid.length === 0) return 50;
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const sd = Math.sqrt(valid.reduce((a, b) => a + (b - mean) ** 2, 0) / valid.length);
  if (sd === 0) return 50;
  return Math.round(Math.max(20, Math.min(80, 50 + 10 * (v - mean) / sd)));
};

export const leagueScoutScaleInv = (v, arr) => {
  if (v == null) return null;
  const valid = arr.filter(x => x != null && !isNaN(x));
  if (valid.length === 0) return 50;
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const sd = Math.sqrt(valid.reduce((a, b) => a + (b - mean) ** 2, 0) / valid.length);
  if (sd === 0) return 50;
  return Math.round(Math.max(20, Math.min(80, 50 - 10 * (v - mean) / sd)));
};
