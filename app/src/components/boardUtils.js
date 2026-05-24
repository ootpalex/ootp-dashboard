// ============================================================================
// BOARD UTILITIES — Shared pool-building logic for Draft/IAFA/R5 boards
// ============================================================================
import {
  getMaxWar,
  getMaxWarP,
  getWar,
  getWarP,
  getRunsP,
  getRpWar,
  getRpWarP,
  getSpWar,
  getSpWarP,
  scaleRpWarP,
  isEligible,
  genericSort,
  pickPitcherRole,
  passesPositionFilter,
} from "../utils/accessors.js";
import { searchFilter } from "../utils/helpers.js";
import { HITTER_POS, CAP_LEAVES, POS_TO_LEAF, DEF_TIERS } from "../utils/constants.js";
import {
  applySmartRank,
  devPercentileRank,
} from "../utils/futureValue.js";

// Cap-charge position for a hitter = the RunsP-best position within the HARDEST
// defensive tier they're ELIGIBLE in. Unlike _bestPos/calcBestPos there is NO
// down-tier demotion: a CF-eligible OF charges CF even if he grades better in a
// corner (he's eligible at CF, so he fills a CF slot, keeping the premium caps
// engaged). RunsP only breaks ties WITHIN the tier (a 2B/3B guy lands at the one
// he fields best — e.g. Chris Hall -> 3B).
function bestPosByTier(h) {
  for (const tier of DEF_TIERS) {
    let best = -Infinity, bestPos = null;
    for (const pos of tier) {
      if (!isEligible(h, pos)) continue;
      const v = getRunsP(h, pos);
      const vv = v == null ? -Infinity : v;
      if (bestPos === null || vv > best) { best = vv; bestPos = pos; }
    }
    if (bestPos !== null) return bestPos;
  }
  if (isEligible(h, "DH")) return "DH";
  return h.meta?.pos ?? h.POS ?? "DH";
}

// Per-leaf FV inputs for the position-cap RELIEF model: for each cap-tree LEAF
// the hitter is eligible in, the (cur, pot) WAR of the highest-potential
// eligible position in that leaf. applySmartRank turns these into per-leaf FVs
// and keeps the best one whose cap chain isn't full. (The 1B/DH-relief
// exclusion + chain penalty are enforced in applySmartRank, not here.)
function hitterGroupFvInputs(h) {
  const out = {};
  CAP_LEAVES.forEach((leaf) => {
    if (!leaf.positions) return;
    let bestPot = null, bestCur = null;
    leaf.positions.forEach((pos) => {
      if (!isEligible(h, pos)) return;
      const pot = getWarP(h, pos);
      if (pot != null && (bestPot == null || pot > bestPot)) { bestPot = pot; bestCur = getWar(h, pos); }
    });
    if (bestPot != null || bestCur != null) out[leaf.id] = { cur: bestCur, pot: bestPot };
  });
  return out;
}

// `devCurves` is `data.meta.devCurve` ({hit, sp, rp}, WAR-keyed). When supplied,
// each pool entry gets `_devPct` precomputed for the optional Dev% display column.
// v21: dev signal is cur-WAR across all three cohorts (hitter `maxWar.wtd`,
// pitcher role-specific cur-WAR via pickPitcherRole). Display only — not in
// the FV formula.
export function buildBoardPool(data, hitterFilter, pitcherFilter, extraFields) {
  const devCurves = data?.meta?.devCurve ?? null;
  const hitCurve = devCurves?.hit ?? null;

  const hitPool = data.hitters.filter(hitterFilter).map((h) => {
    const maxWARP = getMaxWarP(h);
    const maxWAR = getMaxWar(h);
    const devPct = (hitCurve && maxWAR != null) ? devPercentileRank(hitCurve, h._age, maxWAR) : null;
    const eligPos = HITTER_POS.filter((pos) => isEligible(h, pos));
    return {
      ...h,
      _baseVal: maxWARP ?? 0, _currentVal: maxWAR,
      _baseValDisplay: maxWARP ?? 0, _currentValDisplay: maxWAR,
      _devPct: devPct, _devCurve: hitCurve,
      _eligiblePositions: eligPos, _poolType: "hitter",
      _groupFvInputs: hitterGroupFvInputs(h),
      // Charge against the hardest-tier ELIGIBLE position (keeps premium caps
      // engaged — a CF-eligible guy charges CF, not a corner), RunsP breaking
      // ties within the tier (a 2B/3B guy lands at his better glove).
      _primaryLeaf: POS_TO_LEAF[bestPosByTier(h)] ?? null,
      ...(extraFields ? extraFields(h) : {}),
    };
  });
  const pitPool = data.pitchers.filter(pitcherFilter).map((p) => {
    // pickPitcherRole returns raw display + sort/floor keys + role flag. Under
    // WAR the sort keys are raw too (scaleRpWarP is a no-op), so _baseVal/
    // _currentVal and the *Display fields now carry the same unscaled RP WAR.
    const r = pickPitcherRole(p, devCurves, null, 'best');
    const useRpRole = r.role === 'rp';
    const baseVal = r.warPSort ?? 0;            // potential WAR (raw)
    const currentVal = r.warSort ?? r.war ?? 0; // current WAR (raw)
    const rawRpWar = getRpWar(p);
    // Per-group inputs for the relief cap model: SP from SP WAR, RP from RP WAR.
    // scaleRpWarP is an identity passthrough under WAR (kept as the WAA seam).
    const spWarP = getSpWarP(p);
    const groupFvInputs = {};
    if (spWarP != null) groupFvInputs.SP = { cur: getSpWar(p), pot: spWarP };
    const rpWarPScaled = scaleRpWarP(getRpWarP(p));
    if (rpWarPScaled != null) groupFvInputs.RP = { cur: scaleRpWarP(rawRpWar), pot: rpWarPScaled };
    return {
      ...p,
      _baseVal: baseVal, _currentVal: currentVal,
      _baseValDisplay: r.warP ?? 0,
      _currentValDisplay: r.war ?? 0,
      _devPct: r.devPct,
      _devCurve: r.devCurve,
      _role: r.role,
      _rawCurrentVal: useRpRole ? rawRpWar : null,
      _eligiblePositions: [p.meta?.pos ?? p.POS], _poolType: "pitcher",
      _groupFvInputs: groupFvInputs,
      _primaryLeaf: POS_TO_LEAF[String(p._bestPos ?? p.meta?.pos ?? p.POS ?? "").replace("*", "")] ?? (useRpRole ? "RP" : "SP"),
      ...(extraFields ? extraFields(p) : {}),
    };
  });
  return [...hitPool, ...pitPool];
}

export function buildDisplayPool(pool, search, posFilter, sort, toggles, orgNeed, curveSettings, draftContext, extraSortCols) {
  let rows = [...pool];
  rows = searchFilter(rows, search);
  const hasPosFilter = Array.isArray(posFilter) ? posFilter.length > 0 : (posFilter && posFilter !== "ALL");
  if (hasPosFilter) rows = rows.filter((r) => passesPositionFilter(r, posFilter));

  const anyToggle = !!(
    toggles.orgNeed || toggles.devAdj ||
    toggles.posCaps || toggles.signability ||
    toggles.injury  || toggles.intangibles
  );
  const matAge = curveSettings?.maxCurrentAge ?? 27;
  rows = rows.map((p) => {
    // v21: smart rank no longer reads _devPct (formula dropped devPct).
    // _devPct is preserved purely for the optional Dev% display column.
    const rank = anyToggle ? applySmartRank(p, toggles, orgNeed, curveSettings, draftContext) : p._baseVal;
    const matured = p._age != null && p._age >= matAge;
    return {
      ...p,
      _rank: rank,
      // Display-side: column code reads _devPct directly and renders "—" when null.
      _devPct: matured ? null : p._devPct,
    };
  });

  const { col, dir } = sort;
  genericSort(rows, col, dir, { _rank: (p) => p._rank, _devPct: (p) => p._devPct, ...extraSortCols });
  return rows;
}
