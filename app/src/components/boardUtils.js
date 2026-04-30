// ============================================================================
// BOARD UTILITIES — Shared pool-building logic for Draft/IAFA/R5 boards
// ============================================================================
import { getMaxWaa, getMaxWaaP, getSpWaa, getRpWaa, getSpWaaP, getRpWaaP, getBatR, isEligible, genericSort, scaleRpWaaP, pickPitcherRole, passesPositionFilter } from "../utils/accessors.js";
import { searchFilter } from "../utils/helpers.js";
import { HITTER_POS } from "../utils/constants.js";
import { computeDevPercentile, applySmartRank } from "../utils/futureValue.js";

export function buildBoardPool(data, hitterFilter, pitcherFilter, extraFields) {
  const hitPool = data.hitters.filter(hitterFilter).map((h) => {
    const maxWAAP = getMaxWaaP(h);
    const maxWAA = getMaxWaa(h);
    const eligPos = HITTER_POS.filter((pos) => isEligible(h, pos));
    return {
      ...h,
      _baseVal: maxWAAP ?? 0, _currentVal: maxWAA,
      _baseValDisplay: maxWAAP ?? 0, _currentValDisplay: maxWAA,
      _eligiblePositions: eligPos, _poolType: "hitter",
      ...(extraFields ? extraFields(h) : {}),
    };
  });
  const pitPool = data.pitchers.filter(pitcherFilter).map((p) => {
    // pickPitcherRole returns raw display + scaled sort values + role flag.
    // _baseVal/_currentVal stay scaled (used by applySmartRank + FV calc + sort).
    // _baseValDisplay/_currentValDisplay are raw (used by board cell renderers).
    const r = pickPitcherRole(p, null, null, 'best');
    const useRpRole = r.role === 'rp';
    const baseVal = r.waaPSort ?? 0;            // scaled potential
    const currentVal = r.waaSort ?? r.waa ?? 0; // scaled current (or raw fallback)
    const rawRpWaa = getRpWaa(p);
    return {
      ...p,
      _baseVal: baseVal, _currentVal: currentVal,
      _baseValDisplay: r.waaP ?? 0,
      _currentValDisplay: r.waa ?? 0,
      _role: r.role,
      _rawCurrentVal: useRpRole ? rawRpWaa : null,
      _eligiblePositions: [p.meta?.pos ?? p.POS], _poolType: "pitcher",
      ...(extraFields ? extraFields(p) : {}),
    };
  });
  return [...hitPool, ...pitPool];
}

export function computeDevPercentilesMap(pool, data, keyFn) {
  const hitPeers = data.hitters.map((p) => ({ age: p._age, currentWAA: getBatR(p) }));
  const pitPeers = data.pitchers.map((p) => ({ age: p._age, currentWAA: (p.meta?.pos ?? p.POS) === "SP" ? getSpWaa(p) : getRpWaa(p) }));
  const m = new Map();
  pool.forEach((p) => {
    const peers = p._poolType === "hitter" ? hitPeers : pitPeers;
    const devVal = p._poolType === "hitter" ? getBatR(p) : (p._rawCurrentVal ?? p._currentVal);
    m.set(String(keyFn ? keyFn(p) : p.ID), computeDevPercentile(devVal, p._age, peers));
  });
  return m;
}

export function buildDisplayPool(pool, search, posFilter, sort, toggles, orgNeed, scarcity, devPercentiles, curveSettings, extraSortCols) {
  let rows = [...pool];
  rows = searchFilter(rows, search);
  const hasPosFilter = Array.isArray(posFilter) ? posFilter.length > 0 : (posFilter && posFilter !== "ALL");
  if (hasPosFilter) rows = rows.filter((r) => passesPositionFilter(r, posFilter));

  const anyToggle = toggles.orgNeed || toggles.scarcity || toggles.devAdj || toggles.defSpectrum;
  rows = rows.map((p) => ({
    ...p,
    _rank: anyToggle ? applySmartRank(p, toggles, orgNeed, scarcity, devPercentiles, curveSettings) : p._baseVal,
    _devPct: (p._age != null && !p._matured) ? (devPercentiles.get(String(p.ID)) ?? null) : null,
  }));

  const { col, dir } = sort;
  genericSort(rows, col, dir, { _rank: (p) => p._rank, _devPct: (p) => p._devPct, ...extraSortCols });
  return rows;
}
