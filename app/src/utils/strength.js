// ============================================================================
// STRENGTH — Positional strength, org need, scarcity, league percentiles
// ============================================================================
import { num, parseCSVBoolean } from "./helpers.js";
import { getWaa, getWaaP, getSpWaa, getRpWaa, getSpWaaP, getRpWaaP } from "./accessors.js";
import { ALL_DISPLAY_POS, HITTER_POS, DEF_SPECTRUM, DEF_SPECTRUM_POT, DEPTH_N, DEPTH_N_POT } from "./constants.js";

export function calcPositionalStrength(hitters, pitchers, teams) {
  const teamScores = {};

  teams.forEach((team) => {
    const th = hitters.filter((h) => (h.meta?.org ?? h.ORG) === team);
    const tp = pitchers.filter((p) => (p.meta?.org ?? p.ORG) === team);
    teamScores[team] = { current: {}, potential: {} };

    ["current", "potential"].forEach((mode) => {
      const spectrum = mode === "potential" ? DEF_SPECTRUM_POT : DEF_SPECTRUM;
      const depthMap = mode === "potential" ? DEPTH_N_POT : DEPTH_N;
      const usedIds = new Set();
      const posClaimed = {};
      spectrum.forEach((pos) => { posClaimed[pos] = []; });
      const getVal = (h, pos) => {
        let val = mode === "current" ? getWaa(h, pos) : getWaaP(h, pos);
        if (mode === "potential" && val === null) val = getWaa(h, pos);
        return val;
      };

      if (mode === "current") {
        spectrum.forEach((pos) => {
          const cands = th.filter((h) => !usedIds.has(h.ID)).map((h) => ({ id: h.ID, val: getVal(h, pos) })).filter((c) => c.val !== null).sort((a, b) => b.val - a.val);
          if (cands.length > 0) { posClaimed[pos].push(cands[0]); usedIds.add(cands[0].id); }
        });
        spectrum.forEach((pos) => {
          const n = depthMap[pos]; const rem = n - posClaimed[pos].length; if (rem <= 0) return;
          const cands = th.filter((h) => !usedIds.has(h.ID)).map((h) => ({ id: h.ID, val: getVal(h, pos) })).filter((c) => c.val !== null).sort((a, b) => b.val - a.val);
          cands.slice(0, rem).forEach((c) => { posClaimed[pos].push(c); usedIds.add(c.id); });
        });
      } else {
        spectrum.forEach((pos) => {
          const n = depthMap[pos];
          const cands = th.filter((h) => !usedIds.has(h.ID)).map((h) => ({ id: h.ID, val: getVal(h, pos) })).filter((c) => c.val !== null).sort((a, b) => b.val - a.val);
          cands.slice(0, n).forEach((c) => { posClaimed[pos].push(c); usedIds.add(c.id); });
        });
      }
      spectrum.forEach((pos) => { teamScores[team][mode][pos] = posClaimed[pos].reduce((s, c) => s + c.val, 0); });
    });

    const spsCur = tp.filter((p) => (p.starter ?? parseCSVBoolean(p.Starter)) || (p.meta?.pos ?? p.POS) === "SP").map((p) => getSpWaa(p)).filter((v) => v !== null).sort((a, b) => b - a);
    teamScores[team].current.SP = spsCur.slice(0, DEPTH_N.SP).reduce((s, v) => s + v, 0);
    const rpsCur = tp.map((p) => getRpWaa(p)).filter((v) => v !== null).sort((a, b) => b - a);
    teamScores[team].current.RP = rpsCur.slice(0, DEPTH_N.RP).reduce((s, v) => s + v, 0);

    const spElig = tp.filter((p) => (p.starterP ?? parseCSVBoolean(p["Starter P"])) || (p.starter ?? parseCSVBoolean(p.Starter)) || (p.meta?.pos ?? p.POS) === "SP");
    const spsPot = spElig.map((p) => ({ id: p.ID, val: getSpWaaP(p) ?? getSpWaa(p) })).filter((c) => c.val !== null).sort((a, b) => b.val - a.val);
    const spClaimed = new Set(spsPot.slice(0, DEPTH_N_POT.SP).map((c) => c.id));
    teamScores[team].potential.SP = spsPot.slice(0, DEPTH_N_POT.SP).reduce((s, c) => s + c.val, 0);
    const rpsPot = tp.filter((p) => !spClaimed.has(p.ID)).map((p) => ({ id: p.ID, val: getRpWaaP(p) ?? getRpWaa(p) })).filter((c) => c.val !== null).sort((a, b) => b.val - a.val);
    teamScores[team].potential.RP = rpsPot.slice(0, DEPTH_N_POT.RP).reduce((s, c) => s + c.val, 0);
  });

  const zScores = {}, ranks = {};
  ["current", "potential"].forEach((mode) => {
    zScores[mode] = {}; ranks[mode] = {};
    const positions = mode === "potential" ? [...DEF_SPECTRUM_POT, "SP", "RP"] : ALL_DISPLAY_POS;
    positions.forEach((pos) => {
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
  return { teamScores, zScores, ranks };
}

export function calcOrgNeed(team, strength) {
  const zScores = strength.zScores.potential[team] || {};
  const needs = {};
  [...ALL_DISPLAY_POS, ...HITTER_POS].forEach((pos) => {
    const z = zScores[pos] ?? 0;
    needs[pos] = Math.max(0, (-z + 1) * 0.3);
  });
  return needs;
}

export function calcPositionalScarcity(pool) {
  const scarcity = {};
  const allPos = [...new Set(pool.map((p) => p.meta?.pos ?? p.POS))];
  allPos.forEach((pos) => {
    const atPos = pool.filter((p) => (p.meta?.pos ?? p.POS) === pos);
    const sorted = atPos.map((p) => p._baseVal).sort((a, b) => b - a);
    if (sorted.length <= 1) { scarcity[pos] = 0.8; return; }
    const gap = sorted[0] - sorted[Math.min(4, sorted.length - 1)];
    scarcity[pos] = Math.min(1.0, Math.max(0, gap / 3));
  });
  return scarcity;
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
