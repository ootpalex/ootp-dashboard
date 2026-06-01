// ============================================================================
// POSITIONING — Defensive position optimization and player assignment cascade
// ============================================================================
import { isEligible, getRunsP, getWar, getWarP, getSpWar, getRpWar } from "./accessors.js";
import { parseCSVBoolean } from "./helpers.js";
import { DEF_SPECTRUM, DEF_SPECTRUM_POT } from "./constants.js";

export function optimizeDefensivePositions(starters, positions) {
  const players = starters.map((p) => ({
    ...p,
    _eligible: {},
    _runsP: {},
  }));
  positions.forEach((pos) => {
    if (pos === "DH") return;
    players.forEach((p) => {
      p._eligible[pos] = isEligible(p, pos);
      p._runsP[pos] = getRunsP(p, pos);
    });
  });

  const spectrumOrder = ["C", "SS", "CF", "2B", "3B", "LF", "RF", "1B"].filter((p) => positions.includes(p));
  const usedIds = new Set();
  const result = {};

  spectrumOrder.forEach((pos) => {
    const cands = players
      .filter((p) => !usedIds.has(p.ID) && p._eligible[pos])
      .map((p) => ({ player: p, runsP: p._runsP[pos] ?? -999 }))
      .sort((a, b) => b.runsP - a.runsP);
    if (cands.length > 0) {
      result[pos] = { ...cands[0].player, _assignedPos: pos, _defRunsP: cands[0].runsP };
      usedIds.add(cands[0].player.ID);
    }
  });

  const unassigned = players.filter((p) => !usedIds.has(p.ID));
  const unfilledPos = positions.filter((pos) => !result[pos] && pos !== "DH");

  unfilledPos.forEach((pos) => {
    const cands = unassigned
      .filter((p) => !usedIds.has(p.ID))
      .map((p) => ({ player: p, runsP: p._runsP[pos] ?? -999 }))
      .sort((a, b) => b.runsP - a.runsP);
    if (cands.length > 0) {
      result[pos] = { ...cands[0].player, _assignedPos: pos, _defRunsP: cands[0].runsP };
      usedIds.add(cands[0].player.ID);
    }
  });

  if (positions.includes("DH")) {
    const dhPlayers = players.filter((p) => !usedIds.has(p.ID));
    if (dhPlayers.length > 0) {
      result["DH"] = { ...dhPlayers[0], _assignedPos: "DH", _defRunsP: null };
    }
  }

  return positions.map((pos) => result[pos]).filter(Boolean);
}

export function assignPlayersToPositions(hitters, pitchers, depthMap, mode = "current", split = "wtd") {
  const spectrum = mode === "potential" ? DEF_SPECTRUM_POT : DEF_SPECTRUM;
  const usedIds = new Set();
  const assigned = {};
  spectrum.forEach((pos) => { assigned[pos] = []; });
  assigned.SP = [];
  assigned.RP = [];

  const getVal = (h, pos) => {
    let val = mode === "current" ? getWar(h, pos, split) : getWarP(h, pos);
    if (mode === "potential" && val === null) val = getWar(h, pos, split);
    return val;
  };

  if (mode === "current") {
    spectrum.forEach((pos) => {
      const cands = hitters.filter((h) => !usedIds.has(h.ID))
        .map((h) => ({ player: h, val: getVal(h, pos) }))
        .filter((c) => c.val !== null)
        .sort((a, b) => b.val - a.val);
      if (cands.length > 0 && depthMap[pos] > 0) {
        assigned[pos].push({ ...cands[0].player, _assignedPos: pos, _assignedVal: cands[0].val });
        usedIds.add(cands[0].player.ID);
      }
    });
    spectrum.forEach((pos) => {
      const n = depthMap[pos];
      const rem = n - assigned[pos].length;
      if (rem <= 0) return;
      const cands = hitters.filter((h) => !usedIds.has(h.ID))
        .map((h) => ({ player: h, val: getVal(h, pos) }))
        .filter((c) => c.val !== null)
        .sort((a, b) => b.val - a.val);
      cands.slice(0, rem).forEach((c) => {
        assigned[pos].push({ ...c.player, _assignedPos: pos, _assignedVal: c.val });
        usedIds.add(c.player.ID);
      });
    });
  } else {
    spectrum.forEach((pos) => {
      const n = depthMap[pos];
      const cands = hitters.filter((h) => !usedIds.has(h.ID))
        .map((h) => ({ player: h, val: getVal(h, pos) }))
        .filter((c) => c.val !== null)
        .sort((a, b) => b.val - a.val);
      cands.slice(0, n).forEach((c) => {
        assigned[pos].push({ ...c.player, _assignedPos: pos, _assignedVal: c.val });
        usedIds.add(c.player.ID);
      });
    });
  }

  const spDepth = depthMap.SP || 0;
  const rpDepth = depthMap.RP || 0;
  const spElig = pitchers.filter((p) => (p.starter ?? parseCSVBoolean(p.Starter)) || (p.meta?.pos ?? p.POS) === "SP");
  const spCands = spElig
    .map((p) => ({ player: p, val: getSpWar(p) }))
    .filter((c) => c.val !== null)
    .sort((a, b) => b.val - a.val);
  const spClaimedIds = new Set();
  spCands.slice(0, spDepth).forEach((c) => {
    assigned.SP.push({ ...c.player, _assignedPos: "SP", _assignedVal: c.val });
    spClaimedIds.add(c.player.ID);
  });
  const rpCands = pitchers.filter((p) => !spClaimedIds.has(p.ID))
    .map((p) => ({ player: p, val: getRpWar(p) }))
    .filter((c) => c.val !== null)
    .sort((a, b) => b.val - a.val);
  rpCands.slice(0, rpDepth).forEach((c) => {
    assigned.RP.push({ ...c.player, _assignedPos: "RP", _assignedVal: c.val });
  });

  const allAssignedUids = new Set();
  Object.values(assigned).forEach((players) => players.forEach((p) => allAssignedUids.add(p._uid || p.ID)));

  const unassigned = [
    ...hitters.filter((h) => !allAssignedUids.has(h._uid || h.ID)),
    ...pitchers.filter((p) => !allAssignedUids.has(p._uid || p.ID)),
  ];

  return { assigned, unassigned };
}
