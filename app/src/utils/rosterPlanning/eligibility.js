// Contract-status parser, R5/MLFA projections, options info, R5 protect shortlist.
import { parseMLD } from "./_shared.js";

const YL_PATTERN = /^(\d+)\s*(?:\(([^)]+)\))?$/;

/**
 * @param {Object} player
 * @param {number} gameYear
 * @param {Set} [superTwoIds] — Set of player _uid values projected as super-two.
 */
export function parseContractStatus(player, gameYear, superTwoIds) {
  const meta = player.meta || player;
  const yl = (meta.yl || "").trim();
  const mld = meta.mld ?? 0;
  const { years: mlbYears, days: mlbDays } = parseMLD(mld);
  const on40 = meta.on40 === true;
  const lev = meta.lev || "";

  const match = yl.match(YL_PATTERN);
  const yearsLeft = match ? parseInt(match[1], 10) : 0;
  const qualifier = match ? (match[2] || "").trim().toLowerCase() : "";

  let type, optionType = null;

  if (!yl || yearsLeft === 0) {
    type = "fa";
  } else if (qualifier.includes("auto")) {
    type = "pre-arb";
  } else if (qualifier.includes("arbitr")) {
    type = "arb";
  } else if (qualifier.includes("club opt")) {
    type = "signed";
    optionType = "club";
  } else if (qualifier.includes("player opt")) {
    type = "signed";
    optionType = "player";
  } else if (qualifier.includes("vesting")) {
    type = "signed";
    optionType = "vesting";
  } else if (yearsLeft > 0) {
    type = "signed";
  } else {
    type = "fa";
  }

  if (!on40 && lev !== "MLB") {
    if (type === "pre-arb" || type === "fa") {
      type = "minors";
    }
  }

  const uid = player._uid;
  const isSuperTwo = superTwoIds
    ? superTwoIds.has(uid)
    : (type === "arb" && mlbYears < 3) ||
      (type === "pre-arb" && mlbYears === 2 && mlbDays >= 130);

  let controlYears;
  if (type === "signed") {
    controlYears = yearsLeft;
  } else if (type === "pre-arb" || type === "arb") {
    controlYears = Math.max(0, 6 - mlbYears);
  } else {
    controlYears = 0;
  }

  const controlEnd = gameYear + controlYears;
  const faYear = type === "fa" ? gameYear : controlEnd;

  let arbStartYear;
  if (type === "arb") {
    arbStartYear = gameYear;
  } else if (type === "signed") {
    arbStartYear = null;
  } else {
    arbStartYear = gameYear + Math.max(0, 3 - mlbYears);
  }

  let arbYearNum = null;
  if (type === "arb") {
    arbYearNum = Math.max(1, Math.min(3, mlbYears - 2));
  }

  return {
    type, yearsLeft, optionType, controlEnd, faYear,
    arbStartYear, isSuperTwo, controlYears, arbYearNum,
    mlbYears, mlbDays,
  };
}

export function calcR5Projection(player, gameYear, draftDateMap = null) {
  const meta = player.meta || player;
  if (meta.on40 === true) return { r5Year: null, r5Countdown: null, isProtected: true };
  if (meta.r5 === true) return { r5Year: gameYear, r5Countdown: 0, isProtected: false };

  const draftYear = meta.draft;
  const proy = meta.proy ?? 0;

  if (!draftYear && proy === 0) return { r5Year: null, r5Countdown: null, isProtected: false };

  if (!draftYear || draftYear === 0) {
    const r5Year = gameYear + Math.max(0, Math.ceil(5 - proy));
    return { r5Year, r5Countdown: Math.max(0, r5Year - gameYear), isProtected: false };
  }

  let signingAge = 19;
  if (meta.dob) {
    const dob = new Date(meta.dob);
    const draftDate = draftDateMap?.get(draftYear) ?? new Date(draftYear, 6, 1);
    signingAge = Math.floor((draftDate - dob) / (365.25 * 24 * 60 * 60 * 1000));
  }

  const threshold = signingAge <= 18 ? 5 : 4;
  const r5Year = draftYear + threshold;
  return { r5Year, r5Countdown: Math.max(0, r5Year - gameYear), isProtected: false };
}

// MiLB free agency: free agent after 7 professional years.
export function calcMLFA(player, gameYear) {
  const meta = player.meta || player;
  const proy = meta.proy ?? 0;
  const yearsLeft = Math.max(0, Math.ceil(7 - proy));
  return {
    eligible: proy >= 7,
    mlfaYear: gameYear + yearsLeft,
  };
}

export function getOptionsInfo(player, additionalBurned = 0) {
  const meta = player.meta || player;
  const baseUsed = meta.opt ?? 0;
  const used = baseUsed + (additionalBurned || 0);
  const remaining = Math.max(0, 3 - used);
  const on40 = meta.on40 === true;
  return {
    used,
    remaining,
    outOfOptions: on40 && remaining <= 0,
  };
}

// Default WAR threshold for R5 risk = ~+1.0 (≈ −1.0 WAA pre-shift).
// User-tunable via the Roster Planner "R5 risk threshold" slider.
export const R5_DEFAULT_THRESHOLD = 1.0;
export const R5_PROTECT_BUFFER = 0.2;

const scoreOf = (ep) => ep._fv ?? ep._warP ?? ep._war ?? -Infinity;

// A 40-man player is "displaceable" if it's realistic that the user would
// DFA / waive them to make room for a protect. Stars, no-trade contracts,
// and big guaranteed deals are excluded — those slots aren't actually open.
// Threshold 2.5 WAR ≈ "above league-average MLB regular" (~+1 WAA pre-shift).
function isDisplaceable40Man(ep) {
  const meta = ep.meta || {};
  if (meta.on40 !== true) return false;
  if (ep.contract?.noTrade === true) return false;
  if (meta.act === true && (ep._war ?? 0) >= 2.5) return false;
  const yearsLeft = ep._contract?.yearsLeft ?? 0;
  const cv = meta.cv ?? 0;
  if (yearsLeft >= 2 && cv >= 20_000_000) return false;
  return true;
}

/**
 * Partition R5-eligible prospects into protection tiers.
 *
 * Returns:
 *   shortlist / others — legacy threshold-only partition (drives the
 *     Rule 5 worktable + threshold slider summary).
 *   mustProtect / considerProtecting — slot-aware tiers used by Smart
 *     Suggestions. Each entry is { player, score, reason, displacedPlayer?,
 *     displacedScore? }. "Must Protect" means the prospect either fills an
 *     open 40-man slot or beats the matched displaceable-40-man floor by
 *     at least PROTECT_BUFFER. "Consider Protecting" means the prospect
 *     beats the floor but by less than the buffer (borderline call).
 *   debug — { openSlots, fortyManCount, displaceableCount, buffer }.
 */
export function filterR5Protect(
  enrichedPlayers,
  fvThreshold = R5_DEFAULT_THRESHOLD,
  displayYear = null,
  opts = {},
) {
  const fortyManCapacity = opts.fortyManCapacity ?? 40;
  const buffer = opts.protectBuffer ?? R5_PROTECT_BUFFER;

  const exposed = enrichedPlayers.filter(ep => {
    if (ep.meta?.on40 === true || ep._r5?.isProtected) return false;
    if (displayYear != null) {
      return ep._r5?.r5Year != null && ep._r5.r5Year <= displayYear;
    }
    return ep._r5?.r5Countdown != null && ep._r5.r5Countdown <= 1;
  });

  const shortlist = exposed.filter(ep => scoreOf(ep) >= fvThreshold)
    .sort((a, b) => scoreOf(b) - scoreOf(a));
  const others = exposed.filter(ep => scoreOf(ep) < fvThreshold)
    .sort((a, b) => scoreOf(b) - scoreOf(a));

  const fortyMan = enrichedPlayers.filter(ep => ep.meta?.on40 === true);
  const openSlots = Math.max(0, fortyManCapacity - fortyMan.length);
  const displaceablePool = fortyMan
    .filter(isDisplaceable40Man)
    .sort((a, b) => scoreOf(a) - scoreOf(b));

  const mustProtect = [];
  const considerProtecting = [];

  shortlist.forEach((ep, idx) => {
    const score = scoreOf(ep);
    if (idx < openSlots) {
      mustProtect.push({ player: ep, score, reason: "openSlot" });
      return;
    }
    const floorPlayer = displaceablePool[idx - openSlots];
    if (!floorPlayer) return; // no more displaceable slots — drop
    const floorScore = scoreOf(floorPlayer);
    const entry = {
      player: ep,
      score,
      reason: "beatsFloor",
      displacedPlayer: floorPlayer,
      displacedScore: floorScore,
    };
    if (score >= floorScore + buffer) {
      mustProtect.push(entry);
    } else if (score >= floorScore) {
      considerProtecting.push(entry);
    }
  });

  return {
    shortlist,
    others,
    mustProtect,
    considerProtecting,
    debug: {
      openSlots,
      fortyManCount: fortyMan.length,
      displaceableCount: displaceablePool.length,
      buffer,
    },
  };
}
