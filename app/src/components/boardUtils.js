// ============================================================================
// BOARD UTILITIES — Shared pool-building logic for Draft/IAFA/R5 boards
// ============================================================================
import {
  getMaxWar,
  getMaxWarP,
  getRpWar,
  isEligible,
  genericSort,
  pickPitcherRole,
  passesPositionFilter,
} from "../utils/accessors.js";
import { searchFilter } from "../utils/helpers.js";
import { HITTER_POS } from "../utils/constants.js";
import {
  applySmartRank,
  devPercentileRank,
} from "../utils/futureValue.js";

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
      ...(extraFields ? extraFields(h) : {}),
    };
  });
  const pitPool = data.pitchers.filter(pitcherFilter).map((p) => {
    // pickPitcherRole returns raw display + scaled sort/floor + role flag.
    // _baseVal/_currentVal stay scaled (used by applySmartRank + sort).
    // _baseValDisplay/_currentValDisplay are raw (board cell renderers).
    const r = pickPitcherRole(p, devCurves, null, 'best');
    const useRpRole = r.role === 'rp';
    const baseVal = r.warPSort ?? 0;            // scaled potential
    const currentVal = r.warSort ?? r.war ?? 0; // scaled current (or raw fallback)
    const rawRpWar = getRpWar(p);
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
