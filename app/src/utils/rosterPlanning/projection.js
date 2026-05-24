// Roster projection orchestrator: enrichment, year-by-year status, bucket builder.
import { getMaxWar, getMaxWarP, getSpWar, getRpWar, getSpWarP, getRpWarP, scaleRpWarP } from "../accessors.js";
import { fmtSalary } from "../helpers.js";
import { isSpEligible } from "./_shared.js";
import { resolveContractYear } from "./contracts.js";
import { detectSeasonDay, detectLimbo, detectArbSigned, projectSuperTwo } from "./service.js";
import { parseContractStatus, calcR5Projection, calcMLFA, getOptionsInfo } from "./eligibility.js";

// Pitcher _war for roster planning uses the best-of-role value for downstream
// sort / FV calc / crunch decisions. RP values are unscaled under WAR
// (scaleRpWarP is a no-op, kept as the WAA seam). Display surfaces
// (CompactPlayerRow rotation/bullpen panels) override this with role-locked raw
// values via depth.js. Falls back to legacy SP-eligibility logic if Dashboard
// enrichment is missing (e.g. unit tests).
function getPlayerWar(p) {
  if (p._type === "pitcher" || p.meta?.isPitcher) {
    if (p._warSort != null) return p._warSort;
    return isSpEligible(p) ? getSpWar(p) : scaleRpWarP(getRpWar(p));
  }
  return getMaxWar(p);
}

function getPlayerWarP(p) {
  if (p._type === "pitcher" || p.meta?.isPitcher) {
    if (p._warPSort != null) return p._warPSort;
    return isSpEligible(p) ? getSpWarP(p) : scaleRpWarP(getRpWarP(p));
  }
  return getMaxWarP(p);
}

function enrichPlayer(p, gameYear, superTwoIds, draftDateMap) {
  const contract = parseContractStatus(p, gameYear, superTwoIds);
  const r5 = calcR5Projection(p, gameYear, draftDateMap);
  const mlfa = calcMLFA(p, gameYear);
  const options = getOptionsInfo(p);
  const war = getPlayerWar(p);
  const warP = getPlayerWarP(p);

  return {
    ...p,
    _contract: contract,
    _r5: r5,
    _mlfa: mlfa,
    _options: options,
    _war: war,
    _warP: warP,
  };
}

function categorizeToBucket(ep) {
  const meta = ep.meta || ep;
  const on40 = meta.on40 === true;
  const act = meta.act === true;
  const contract = ep._contract;

  if (contract.type === "fa") return "departing";
  if (meta._ilLong) return "ilLong";
  if (meta._ilShort) return "ilShort";
  if (on40 && act) return "active";
  if (on40 && !act) return "fortyMan";
  if (!on40 && ep._r5.r5Countdown != null && ep._r5.r5Countdown <= 1 && !ep._r5.isProtected) {
    return "r5Risk";
  }
  if (!on40) return "prospects";
  return "fortyMan";
}

function projectYearStatus(ep, yearOffset, gameYear) {
  const contract = ep._contract;
  const targetYear = gameYear + yearOffset;
  const spContract = ep._spContract;

  if (ep._declinedOptionYear != null && targetYear >= ep._declinedOptionYear) {
    return { status: "fa", label: "FA", statusLabel: "FA" };
  }

  if (ep._salaryReport) {
    const yr = ep._salaryReport.years[targetYear];
    if (yr) {
      if (yr.status && !yr.type) {
        if (yr.status === "option" && ep._acceptedOptionYear === targetYear) {
          return { ...yr, status: "signed", statusLabel: "Accepted", guaranteed: true };
        }
        return yr;
      }
      const label = fmtSalary(yr.salary) || (yr.type ? yr.type.toUpperCase() : "Signed");
      const g = yr.guaranteed;
      switch (yr.type) {
        case "fa":             return { status: "fa",     label: "FA",         statusLabel: "FA" };
        case "milb":           return { status: "minors", label: "MiLB",       statusLabel: "MiLB" };
        case "milc":           return { status: "minors", label: "MiLC",       statusLabel: "MiLC" };
        case "arb":            return { status: "arb",    label,               statusLabel: "Arb",        salary: yr.salary, guaranteed: g };
        case "arb_uncertain":  return { status: "arb",    label,               statusLabel: "Arb?",       salary: yr.salary, guaranteed: g };
        case "team_option":    return ep._acceptedOptionYear === targetYear
          ? { status: "signed", label, statusLabel: "Accepted", salary: yr.salary, guaranteed: true }
          : { status: "option", label,  statusLabel: "Team Opt",   salary: yr.salary, guaranteed: g, optionType: "club" };
        case "player_option":  return { status: "option", label,               statusLabel: "Player Opt", salary: yr.salary, guaranteed: g, optionType: "player" };
        case "vesting_option": return { status: "option", label,               statusLabel: "Vest Opt",   salary: yr.salary, guaranteed: g, optionType: "vesting" };
        case "opt_out":        return { status: "signed", label,               statusLabel: "Opt-out",    salary: yr.salary, guaranteed: g };
        case "retained":       return { status: "signed", label,               statusLabel: "Retained",   salary: yr.salary, guaranteed: g };
        default:               return { status: "signed", label,               statusLabel: "Signed",     salary: yr.salary, guaranteed: g };
      }
    }
  }

  if (spContract) {
    const resolved = resolveContractYear(spContract, targetYear);
    if (resolved && resolved.salary > 0) {
      const label = fmtSalary(resolved.salary) || "Signed";
      if (resolved.optionType) {
        const statusLabel = resolved.optionType === "club" ? "Club Opt" : resolved.optionType === "player" ? "Player Opt" : "Vesting Opt";
        return { status: "option", label, statusLabel, optionType: resolved.optionType, buyout: resolved.buyout, salary: resolved.salary };
      }
      return { status: "signed", label, statusLabel: "Signed", salary: resolved.salary };
    }
  }

  if (contract.type !== "minors" && targetYear >= contract.faYear) return { status: "fa", label: "FA", statusLabel: "FA" };

  if (contract.type === "signed") {
    if (yearOffset < contract.yearsLeft) {
      if (yearOffset === contract.yearsLeft - 1 && contract.optionType) {
        const statusLabel = contract.optionType === "club" ? "Club Opt" : contract.optionType === "player" ? "Player Opt" : "Vesting Opt";
        return { status: "option", label: "Signed", statusLabel, optionType: contract.optionType };
      }
      return { status: "signed", label: "Signed", statusLabel: "Signed" };
    }
    return { status: "fa", label: "FA", statusLabel: "FA" };
  }

  if (contract.type === "minors") {
    if (ep.meta?.on40 === true) {
      const projectedMlbYears = contract.mlbYears + yearOffset;
      if (projectedMlbYears >= 6) return { status: "fa", label: "FA", statusLabel: "FA" };
      return { status: "pre-arb", label: "Pre-Arb", statusLabel: "Pre-Arb" };
    }
    const mlfaYear = ep._mlfa?.mlfaYear;
    if (mlfaYear != null && targetYear >= mlfaYear) {
      return { status: "fa", label: "MiLB FA", statusLabel: "MiLB FA" };
    }
    return { status: "minors", label: "MiLB", statusLabel: "MiLB" };
  }

  const projectedMlbYears = contract.mlbYears + yearOffset;
  if (projectedMlbYears >= 6) return { status: "fa", label: "FA", statusLabel: "FA" };

  if (contract.type === "pre-arb") {
    const yearsUntilArb = contract.arbStartYear != null
      ? Math.max(0, contract.arbStartYear - gameYear) : 1;
    if (yearOffset < yearsUntilArb) return { status: "pre-arb", label: "Pre-Arb", statusLabel: "Pre-Arb" };
    const arbNum = Math.min(3, yearOffset - yearsUntilArb + 1);
    const s2Tag = contract.isSuperTwo && arbNum === 1 ? " (S2)" : "";
    return { status: "arb", label: `Arb-${arbNum}${s2Tag}`, statusLabel: `Arb-${arbNum}${s2Tag}` };
  }

  if (contract.type === "arb") {
    const currentArbNum = contract.arbYearNum || 1;
    const projectedArbNum = currentArbNum + yearOffset;
    if (projectedArbNum > 3 || projectedMlbYears >= 6) return { status: "fa", label: "FA", statusLabel: "FA" };
    return { status: "arb", label: `Arb-${projectedArbNum}`, statusLabel: `Arb-${projectedArbNum}` };
  }

  return { status: "fa", label: "FA", statusLabel: "FA" };
}

/**
 * @param {Array} teamPlayers — players on this team
 * @param {number} gameYear
 * @param {Object} [userMoves] — drag-and-drop move overrides { [uid]: { action, startYear } }.
 * @param {Array} [allPlayers] — full league player pool (for super-two projection).
 * @param {Map} [contractsMap] — StatsPlus contract data keyed by player_id.
 * @param {number} [displayYear] — which year to build buckets for (default: gameYear + 1).
 * @param {number} [yearRange] — how many future years to project (default: 3).
 */
export function buildRosterProjection(teamPlayers, gameYear, userMoves = {}, allPlayers = null, contractsMap = null, displayYear = null, yearRange = 3, salaryReportMap = null, draftDateMap = null) {
  if (!displayYear) displayYear = gameYear + 1;

  const hasMoves = userMoves && Object.keys(userMoves).some(k => userMoves[k]);
  const allHaveBaseline = teamPlayers.length > 0 && teamPlayers.every(p =>
    p._projection && p._projection.baseline && Object.keys(p._projection.baseline).length > 0
  );
  const useFastPath = !hasMoves && allHaveBaseline;

  let superTwoIds = null;
  let superTwoInfo = null;
  if (allPlayers && allPlayers.length > 0) {
    const seasonDay = detectSeasonDay(allPlayers);
    const limbo = detectLimbo(allPlayers, seasonDay);
    const arbSigned = limbo && detectArbSigned(allPlayers);
    const algoOffset = displayYear - gameYear - 1;
    const s2 = projectSuperTwo(allPlayers, { seasonDay, limbo, algoOffset });
    superTwoIds = new Set(s2.candidates.filter(c => c.isSuperTwo).map(c => c.player._uid));
    superTwoInfo = {
      cutoffMLD: s2.cutoffMLD,
      cutoffLabel: s2.cutoffLabel,
      cutoffIndex: s2.cutoffIndex,
      daysToAdd: s2.daysToAdd,
      candidates: s2.candidates,
      seasonDay,
      limbo,
      arbSigned,
      algoOffset,
      count: superTwoIds.size,
    };
  }

  const enriched = teamPlayers.map(p => {
    const ep = enrichPlayer(p, gameYear, superTwoIds, draftDateMap);
    const pid = String(p.ID || p.id || p._uid);
    if (contractsMap) {
      ep._spContract = contractsMap.get(pid) || null;
    }
    if (salaryReportMap) {
      ep._salaryReport = salaryReportMap.get(pid) || null;
    }
    return ep;
  });

  // Pre-bucket arb decisions (year-scoped composite keys) by player uid, since
  // the main move-handling loop indexes regular moves by uid alone.
  const nonTenderByUid = {};
  for (const [key, mv] of Object.entries(userMoves)) {
    if (!key.startsWith("t:") || mv.action !== "nonTender") continue;
    const uid = mv.uid;
    const yr = mv.startYear;
    if (uid == null || yr == null) continue;
    if (nonTenderByUid[uid] == null || yr < nonTenderByUid[uid]) {
      nonTenderByUid[uid] = yr;
    }
  }

  enriched.forEach(ep => {
    const earliestNonTender = nonTenderByUid[ep._uid];
    if (earliestNonTender != null && earliestNonTender <= displayYear) {
      ep._removed = true;
    }

    const move = userMoves[ep._uid];
    if (!move) return;
    const startYear = move.startYear || move.year || (gameYear + 1);
    if (startYear > displayYear) return;
    if (move.action === "protect") {
      ep.meta = { ...ep.meta, on40: true };
      ep._r5 = { ...ep._r5, isProtected: true };
    } else if (move.action === "dfa" || move.action === "trade" || move.action === "release") {
      ep._removed = true;
    } else if (move.action === "promote") {
      ep.meta = { ...ep.meta, act: true, on40: true, _ilShort: false, _ilLong: false };
    } else if (move.action === "demote") {
      ep.meta = { ...ep.meta, act: false };
    } else if (move.action === "ilShort") {
      ep.meta = { ...ep.meta, _ilShort: true, _ilLong: false };
    } else if (move.action === "ilLong") {
      ep.meta = { ...ep.meta, _ilLong: true, _ilShort: false, on40: true };
    } else if (move.action === "sign") {
      ep.meta = { ...ep.meta, on40: true };
      ep._contract = { ...ep._contract, type: "signed", yearsLeft: 99, faYear: gameYear + 99 };
    } else if (move.action === "sign_milb") {
      ep._contract = { ...ep._contract, type: "signed_minors", yearsLeft: 99, faYear: gameYear + 99 };
    } else if (move.action === "decline_option") {
      ep._declinedOptionYear = startYear;
    } else if (move.action === "accept_option") {
      ep._acceptedOptionYear = startYear;
    }
  });

  const active = enriched.filter(ep => !ep._removed);

  // Cascading option-burn calculation: a player on the inactive 40-man (not on
  // active, but on40) burns one option year per season. meta.oy === true marks
  // the *current* season as already-optioned, so it doesn't double-count.
  // Future-season burns are inferred from demote/promote moves.
  active.forEach(ep => {
    const m = ep.meta || {};
    const baseUsed = m.opt ?? 0;
    const move = userMoves[ep._uid];
    const burnByYear = {};
    let cumulative = 0;
    let usedAtStartOfDisplay = baseUsed;
    let burnedInDisplayYear = false;
    for (let y = gameYear; y <= displayYear; y++) {
      if (y === gameYear) {
        // Current season: meta.opt already includes any in-season usage and
        // meta.oy is the authoritative "is one being used this year" flag.
        burnByYear[y] = 0;
        if (y === displayYear) {
          usedAtStartOfDisplay = baseUsed - (((m.oy ?? 0) > 0) ? 1 : 0);
          burnedInDisplayYear = (m.oy ?? 0) > 0;
        }
        continue;
      }
      // Future year: project from demote/promote moves (or natural state if none).
      let inactive40;
      if (move && (move.action === "demote" || move.action === "promote")) {
        const sY = move.startYear || (gameYear + 1);
        inactive40 = (y >= sY)
          ? (move.action === "demote" && m.on40 === true)
          : ((m.act !== true) && m.on40 === true);
      } else {
        inactive40 = (m.act !== true) && m.on40 === true;
      }
      if (y === displayYear) {
        usedAtStartOfDisplay = baseUsed + cumulative;
        burnedInDisplayYear = inactive40;
      }
      if (inactive40) cumulative += 1;
      burnByYear[y] = cumulative;
    }
    ep._optionBurnByYear = burnByYear;
    const opts = getOptionsInfo(ep, burnByYear[displayYear] || 0);
    // "Last Option Year": the year a player USES their 3rd option. Fires only
    // the season they cross from 2-used to 3-used. The next year (NoOpt) means
    // any further demote requires waivers.
    opts.isLastOptionYear = burnedInDisplayYear && usedAtStartOfDisplay < 3 && opts.used >= 3;
    ep._options = opts;
  });

  const buckets = { active: [], fortyMan: [], ilShort: [], ilLong: [], r5Risk: [], prospects: [], departing: [] };
  active.forEach(ep => { buckets[categorizeToBucket(ep)].push(ep); });

  const sortByVal = (a, b) => (b._fv ?? b._war ?? -999) - (a._fv ?? a._war ?? -999);
  Object.values(buckets).forEach(arr => arr.sort(sortByVal));

  const years = {};
  for (let offset = 0; offset <= 3; offset++) {
    const year = gameYear + offset;
    const yearData = {};
    if (useFastPath) {
      const yKey = String(year);
      active.forEach(ep => {
        const baseline = ep._projection?.baseline;
        const st = baseline ? (baseline[yKey] || baseline[year]) : null;
        yearData[ep._uid] = st || projectYearStatus(ep, offset, gameYear);
      });
    } else {
      active.forEach(ep => { yearData[ep._uid] = projectYearStatus(ep, offset, gameYear); });
    }
    years[year] = yearData;
  }

  if (displayYear > gameYear) {
    const dyData = years[displayYear] || {};
    const nonDeparting = ["active", "fortyMan", "r5Risk", "prospects"];
    nonDeparting.forEach(bucket => {
      buckets[bucket] = buckets[bucket].filter(ep => {
        const s = dyData[ep._uid];
        if (s?.status === "fa") { buckets.departing.push(ep); return false; }
        return true;
      });
    });
    buckets.departing.sort(sortByVal);

    buckets.prospects = buckets.prospects.filter(ep => {
      const r5Year = ep._r5?.r5Year;
      if (r5Year != null && r5Year <= displayYear && !ep._r5.isProtected) {
        buckets.r5Risk.push(ep);
        return false;
      }
      return true;
    });
    buckets.r5Risk.sort(sortByVal);
  }

  const onFortyMan = ep => ep.meta?.on40 === true;
  // 40-man count: includes active + inactive 40-man + Short-Term IL (15-day stays
  // on 40-man). Long-Term IL (60-day) is removed from the 40-man.
  const fortyManCount = [
    ...buckets.active,
    ...buckets.fortyMan,
    ...buckets.ilShort,
  ].filter(onFortyMan).length;
  // Active count: 26-man only — IL of any kind comes off the active count.
  const activeCount = buckets.active.filter(ep => onFortyMan(ep) && ep.meta?.act === true).length;
  const outOfOptions = active.filter(ep => ep._options.outOfOptions).length;

  return { buckets, years, enriched: active, fortyManCount, activeCount, outOfOptions, gameYear, superTwoInfo };
}
