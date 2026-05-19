// 26-man and inactive 40-man coverage analyzers + depth chart builder.
import { getSpWar, getRpWar, getSpWarP, getRpWarP, isEligible, isCurrentlyEligible } from "../accessors.js";
import { isSpEligible } from "./_shared.js";

const COVERAGE_POSITIONS = ["C", "1B", "2B", "SS", "3B", "LF", "CF", "RF"];

function isPitcher(ep) {
  return ep._type === "pitcher" || ep.meta?.isPitcher;
}

// Classify pitchers into SP vs RP roles. Top N SP-eligible pitchers by SP WAR
// fill the rotation; every other pitcher fills the bullpen. Each returned row
// has role-locked _war / _warP / _fv (raw display values) so the depth chart
// panels show SP-only values in rotation slots and RP-only in bullpen slots.
export function classifyPitchers(pitchers, spSlots) {
  const bySp = [...pitchers]
    .filter(p => isSpEligible(p) && getSpWar(p) != null)
    .sort((a, b) => (getSpWar(b) ?? -999) - (getSpWar(a) ?? -999));
  const sp = bySp.slice(0, spSlots).map(p => ({
    ...p,
    _war: p._sp?.war ?? getSpWar(p),
    _warP: p._sp?.warP ?? getSpWarP(p),
    _fv: p._sp?.fv ?? p._fv,
  }));
  const taken = new Set(sp.map(p => p._uid));
  const rp = pitchers
    .filter(p => !taken.has(p._uid))
    .sort((a, b) => (getRpWar(b) ?? -999) - (getRpWar(a) ?? -999))
    .map(p => ({
      ...p,
      _war: p._rp?.war ?? getRpWar(p),
      _warP: p._rp?.warP ?? getRpWarP(p),
      _fv: p._rp?.fv ?? p._fv,
    }));
  return { sp, rp };
}

export function analyzeActiveCoverage(active26) {
  const hitters = active26.filter(ep => !isPitcher(ep));
  const pitchers = active26.filter(ep => isPitcher(ep));

  const coverage = {};
  const coveragePotential = {};
  const coverageUids = {};
  const coverageUidsPotential = {};
  COVERAGE_POSITIONS.forEach(pos => {
    const current = hitters.filter(ep => isCurrentlyEligible(ep, pos));
    const potentialOnly = hitters.filter(ep => isEligible(ep, pos) && !isCurrentlyEligible(ep, pos));
    coverage[pos] = current.length;
    coveragePotential[pos] = potentialOnly.length;
    coverageUids[pos] = new Set(current.map(ep => ep._uid));
    coverageUidsPotential[pos] = new Set(potentialOnly.map(ep => ep._uid));
  });

  const { sp: spList, rp: rpList } = classifyPitchers(pitchers, 5);
  const spCount = spList.length;
  const rpCount = rpList.length;
  coverageUids.SP = new Set(pitchers.filter(isSpEligible).map(ep => ep._uid));
  coverageUids.RP = new Set(pitchers.filter(p => !isSpEligible(p)).map(ep => ep._uid));
  coverageUidsPotential.SP = new Set();
  coverageUidsPotential.RP = new Set();

  const warnings = [];

  if (coverage.C < 2) {
    warnings.push({
      type: "coverage", pos: "C", severity: "error",
      message: `Only ${coverage.C} C-eligible player${coverage.C === 1 ? "" : "s"} on 26-man — need 2 (starter + backup).`,
    });
  }

  COVERAGE_POSITIONS.filter(p => p !== "C").forEach(pos => {
    const count = coverage[pos];
    if (count < 2) {
      warnings.push({
        type: "coverage", pos, severity: "error",
        message: `No injury backup at ${pos} — only ${count} eligible player on 26-man.`,
      });
    } else if (count < 3) {
      warnings.push({
        type: "coverage", pos, severity: "info",
        message: `${pos} coverage is minimal (2 eligible) — a double injury leaves the position exposed.`,
      });
    }
  });

  if (pitchers.length > 14) {
    warnings.push({
      type: "balance", severity: "error",
      message: `26-man is over-pitched: ${pitchers.length} pitchers / ${hitters.length} hitters.`,
    });
  } else if (pitchers.length < 12 && hitters.length + pitchers.length >= 25) {
    warnings.push({
      type: "balance", severity: "error",
      message: `26-man is under-pitched: only ${pitchers.length} pitchers.`,
    });
  }

  if (spCount < 5) {
    warnings.push({
      type: "role", severity: "error",
      message: `Only ${spCount} SP-eligible pitcher${spCount === 1 ? "" : "s"} on 26-man — need 5 for a rotation.`,
    });
  }

  return {
    coverage,
    coveragePotential,
    coverageUids,
    coverageUidsPotential,
    hitterCount: hitters.length,
    pitcherCount: pitchers.length,
    spCount,
    rpCount,
    spList,
    rpList,
    warnings,
  };
}

const INACTIVE_TILE_POSITIONS = ["C", "SS", "CF"];

export function analyzeInactiveCoverage(inactive40) {
  const hitters = inactive40.filter(ep => !isPitcher(ep));
  const pitchers = inactive40.filter(ep => isPitcher(ep));

  const coverage = {};
  const coveragePotential = {};
  const coverageUids = {};
  const coverageUidsPotential = {};
  INACTIVE_TILE_POSITIONS.forEach(pos => {
    const current = hitters.filter(ep => isCurrentlyEligible(ep, pos));
    const potentialOnly = hitters.filter(ep => isEligible(ep, pos) && !isCurrentlyEligible(ep, pos));
    coverage[pos] = current.length;
    coveragePotential[pos] = potentialOnly.length;
    coverageUids[pos] = new Set(current.map(ep => ep._uid));
    coverageUidsPotential[pos] = new Set(potentialOnly.map(ep => ep._uid));
  });

  const { sp: spList, rp: rpList } = classifyPitchers(pitchers, 2);
  coverage.SP = spList.length;
  coverage.RP = rpList.length;
  coveragePotential.SP = 0;
  coveragePotential.RP = 0;
  coverageUids.SP = new Set(pitchers.filter(isSpEligible).map(ep => ep._uid));
  coverageUids.RP = new Set(pitchers.filter(p => !isSpEligible(p)).map(ep => ep._uid));
  coverageUidsPotential.SP = new Set();
  coverageUidsPotential.RP = new Set();

  const warnings = [];
  const tileReq = { C: 1, SS: 1, CF: 1, SP: 2, RP: 2 };
  Object.entries(tileReq).forEach(([pos, need]) => {
    if (coverage[pos] < need) {
      warnings.push({
        type: "depth", pos, severity: "error",
        message: `Inactive 40-man lacks ${pos} depth — have ${coverage[pos]}, need ${need}.`,
      });
    }
  });

  return {
    coverage, coveragePotential,
    coverageUids, coverageUidsPotential,
    spList, rpList,
    hitterCount: hitters.length, pitcherCount: pitchers.length,
    warnings, requirements: tileReq,
  };
}

/**
 * Build the structured depth chart for the current roster.
 */
export function buildDepthChart(enrichedPlayers) {
  const onIl = ep => ep.meta?._ilShort === true || ep.meta?._ilLong === true;
  const active = enrichedPlayers.filter(ep => ep.meta?.act === true && ep.meta?.on40 === true && !onIl(ep));
  const inactive40 = enrichedPlayers.filter(ep => ep.meta?.on40 === true && ep.meta?.act !== true && !onIl(ep));
  const ilShort = enrichedPlayers.filter(ep => ep.meta?._ilShort === true);
  const ilLong = enrichedPlayers.filter(ep => ep.meta?._ilLong === true);

  const sortByWar = (a, b) => (b._war ?? -999) - (a._war ?? -999);

  const coverage = analyzeActiveCoverage(active);
  const inactiveCoverage = analyzeInactiveCoverage(inactive40);

  const buildSlots = (players, coverageResult) => {
    const classifiedHit = new Set();
    const C = players.filter(ep => !isPitcher(ep) && (ep.meta?.pos === "C" || isEligible(ep, "C"))).sort(sortByWar);
    C.forEach(ep => classifiedHit.add(ep._uid));
    const IF = players.filter(ep => !isPitcher(ep) && !classifiedHit.has(ep._uid) && ["1B","2B","3B","SS"].includes(ep.meta?.pos)).sort(sortByWar);
    IF.forEach(ep => classifiedHit.add(ep._uid));
    const OF = players.filter(ep => !isPitcher(ep) && !classifiedHit.has(ep._uid) && ["LF","CF","RF"].includes(ep.meta?.pos)).sort(sortByWar);
    OF.forEach(ep => classifiedHit.add(ep._uid));
    const DH = players.filter(ep => !isPitcher(ep) && !classifiedHit.has(ep._uid) && ep.meta?.pos === "DH").sort(sortByWar);
    DH.forEach(ep => classifiedHit.add(ep._uid));
    const bench = players.filter(ep => !isPitcher(ep) && !classifiedHit.has(ep._uid)).sort(sortByWar);
    return {
      C, IF, OF, DH, bench,
      SP: [...coverageResult.spList].sort(sortByWar),
      RP: [...coverageResult.rpList].sort(sortByWar),
    };
  };

  const activeSlots = buildSlots(active, coverage);
  const inactiveSlots = buildSlots(inactive40, inactiveCoverage);

  const fortyHitters = [...active, ...inactive40].filter(ep => !isPitcher(ep)).length;
  const fortyPitchers = [...active, ...inactive40].filter(isPitcher).length;
  const balanceWarnings = [];
  if (fortyPitchers > 24) {
    balanceWarnings.push({
      type: "balance", severity: "info",
      message: `40-man is pitcher-heavy: ${fortyPitchers} pitchers / ${fortyHitters} hitters.`,
    });
  } else if (fortyHitters > 24) {
    balanceWarnings.push({
      type: "balance", severity: "info",
      message: `40-man is hitter-heavy: ${fortyHitters} hitters / ${fortyPitchers} pitchers.`,
    });
  }

  return {
    activeSlots,
    inactiveSlots,
    ilShort,
    ilLong,
    coverage,
    inactiveCoverage,
    warnings: [...coverage.warnings, ...inactiveCoverage.warnings, ...balanceWarnings],
    counts: {
      active: active.length,
      inactive40: inactive40.length,
      fortyHitters,
      fortyPitchers,
      ilShort: ilShort.length,
      ilLong: ilLong.length,
    },
  };
}
