// ============================================================================
// ACCESSORS — Data accessor functions, resolveKey, genericSort
// ============================================================================
import { num, parseCSVBoolean } from "./helpers.js";
import { IP_SP, IP_RP, RP_SCALE_THRESHOLD } from "./constants.js";
import { calcFutureValue, devPercentileRank } from "./futureValue.js";

export const getWaa = (p, pos, split = "wtd") => {
  const v = p.positions?.[pos.toLowerCase()]?.waa?.[split];
  return v != null ? v : num(p[`${pos} WAA ${split}`]);
};

export const getWaaP = (p, pos) => {
  const v = p.prospect?.waa?.[pos.toLowerCase()];
  return v != null ? v : num(p[`${pos} WAA P`]);
};

// WAR accessors — primary value metric for v0.2.0+. WAA accessors retained
// above for a future toggle to display raw WAA alongside.
export const getWar = (p, pos, split = "wtd") => {
  const v = p.positions?.[pos.toLowerCase()]?.war?.[split];
  return v != null ? v : num(p[`${pos} WAR ${split}`]);
};

export const getWarP = (p, pos) => {
  const v = p.prospect?.war?.[pos.toLowerCase()];
  return v != null ? v : num(p[`${pos} WAR P`]);
};

export const getRunsP = (p, pos) => {
  const v = p.positions?.[pos.toLowerCase()]?.stats?.runsP;
  return v != null ? v : num(p[`${pos} RunsP`]);
};

export const isEligible = (p, pos) => {
  if (p.positions) return p.positions[pos.toLowerCase()]?.eligible ?? false;
  return parseCSVBoolean(p[`${pos} Eligible`]);
};

export const INF_POSITIONS = ["1B", "2B", "3B", "SS"];
export const OF_POSITIONS = ["LF", "CF", "RF"];

// Expand a position hint (string or array) into a flat list of specific
// field positions. INF/OF expand to their member positions. Broad keys
// (Hitters/Pitchers/SP/RP) are dropped — they don't pin a fielding position.
const _expandFieldPositions = (posHint) => {
  const arr = Array.isArray(posHint) ? posHint : [posHint];
  const out = new Set();
  for (const ph of arr) {
    if (ph === "INF") INF_POSITIONS.forEach((x) => out.add(x));
    else if (ph === "OF") OF_POSITIONS.forEach((x) => out.add(x));
    else if (ph && !["Hitters", "Pitchers", "SP", "RP"].includes(ph)) out.add(ph);
  }
  return [...out];
};

// For a specific field position, group ('INF' | 'OF'), or array of any of those,
// return { war, warP, fv } using the best eligible matching position's values.
// curveSettings optional — when provided, computes FV via calcFutureValue;
// otherwise fv = war.
// Returns null if the player is not eligible at any matching position.
export const pickFielderPos = (p, posHint, hitDevCurve = null, curveSettings = null) => {
  if (!posHint) return null;
  const positions = _expandFieldPositions(posHint);
  if (!positions.length) return null;
  const eligible = positions.filter((pos) => isEligible(p, pos));
  if (!eligible.length) return null;
  let bestWar = null, bestWarP = null;
  for (const pos of eligible) {
    const w = getWar(p, pos);
    const wp = getWarP(p, pos);
    if (w != null && (bestWar == null || w > bestWar)) bestWar = w;
    if (wp != null && (bestWarP == null || wp > bestWarP)) bestWarP = wp;
  }
  let fv = bestWar;
  if (bestWar != null && curveSettings != null) {
    fv = calcFutureValue(bestWar, bestWarP, p._age, curveSettings);
  }
  return { war: bestWar, warP: bestWarP, fv };
};

// Eligibility-based membership check for the unified position filter.
// Accepts a single string or an array of selections. Empty / null / "ALL" =
// pass. Multi-select uses OR semantics.
const _matchesSinglePosFilter = (p, posFilter) => {
  const isPitcher = p._type === "pitcher" || p._poolType === "pitcher";
  if (posFilter === "Pitchers") return isPitcher;
  if (posFilter === "Hitters") return !isPitcher;
  if (posFilter === "SP") return isPitcher && getSpWar(p) != null;
  if (posFilter === "RP") return isPitcher && getSpWar(p) == null;
  if (posFilter === "INF") return !isPitcher && INF_POSITIONS.some((pos) => isEligible(p, pos));
  if (posFilter === "OF") return !isPitcher && OF_POSITIONS.some((pos) => isEligible(p, pos));
  return !isPitcher && isEligible(p, posFilter);
};
// ─────────────────────────────────────────────────────────────
// LEVEL FILTER — auto-detected, with rookie sub-leagues collapsed.
// Categories: MLB, AAA, AA, A+, A, A-, Rookie (DSL/GCL/AZL/FCL/ACL/R/etc.), INT.
// ─────────────────────────────────────────────────────────────
export const STANDARD_LEVELS = ["MLB", "AAA", "AA", "A+", "A", "A-"];
export const LEVEL_CATEGORY_ORDER = ["MLB", "AAA", "AA", "A+", "A", "A-", "Rookie", "INT"];

export const categorizeLevel = (lev) => {
  if (lev == null || lev === "") return null;
  if (STANDARD_LEVELS.includes(lev)) return lev;
  if (lev === "INT") return "INT";
  return "Rookie";
};

// passesLevelFilter — array filter values can be either:
//   - a category string ("MLB", "Rookie", ...) — matches by categorized level
//   - "team:<team_id>" — matches by player's team_id (rookie disambiguator)
//   - "tm:<tm>" — fallback matches by player's tm string
export const passesLevelFilter = (p, levelFilter) => {
  if (!levelFilter) return true;
  if (Array.isArray(levelFilter)) {
    if (levelFilter.length === 0) return true;
    const lev = p.meta?.lev ?? p.Lev;
    const cat = categorizeLevel(lev);
    const tid = p.meta?.team_id;
    const tm = p.meta?.tm;
    return levelFilter.some((entry) => {
      if (typeof entry !== "string") return false;
      if (entry.startsWith("team:")) return tid != null && String(tid) === entry.slice(5);
      if (entry.startsWith("tm:")) return tm != null && tm === entry.slice(3);
      return cat === entry;
    });
  }
  if (levelFilter === "ALL") return true;
  return categorizeLevel(p.meta?.lev ?? p.Lev) === levelFilter;
};

export const passesPositionFilter = (p, posFilter) => {
  if (!posFilter) return true;
  if (Array.isArray(posFilter)) {
    if (posFilter.length === 0) return true;
    return posFilter.some((f) => _matchesSinglePosFilter(p, f));
  }
  if (posFilter === "ALL") return true;
  return _matchesSinglePosFilter(p, posFilter);
};

// Position rating accessors (OOTP current rating bakes in experience + ability).
// Potential is the innate ceiling. On the 20-80 scouting scale.
export const POS_RATING_MIN = 50;
export const POS_RATING_PCT = 0.75;

export const getPosRating = (p, pos) =>
  p.fieldingRatings?.posRatings?.[pos.toLowerCase()] ?? null;

export const getPosPotential = (p, pos) =>
  p.fieldingRatings?.posPotentials?.[pos.toLowerCase()] ?? null;

// Field positions use OOTP's position rating system; SP/RP/DH do not.
// Missing ratings at a field position = no in-game experience = potential only.
const FIELD_POSITIONS = new Set(["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"]);

// "Currently eligible" = potentially eligible AND current rating is either
// ≥ POS_RATING_MIN or has reached POS_RATING_PCT of its potential.
// For SP/RP/DH, falls back to plain isEligible() when ratings are missing.
export const isCurrentlyEligible = (p, pos) => {
  if (!isEligible(p, pos)) return false;
  const cur = getPosRating(p, pos);
  const pot = getPosPotential(p, pos);
  if (cur == null || pot == null) return !FIELD_POSITIONS.has(pos.toUpperCase());
  if (cur >= POS_RATING_MIN) return true;
  return cur >= POS_RATING_PCT * pot;
};

export const eligibilityStatus = (p, pos) => {
  if (!isEligible(p, pos)) return "none";
  return isCurrentlyEligible(p, pos) ? "current" : "potential";
};

export const getMaxWaa = (p, split = "wtd") => {
  const v = p.maxWaa?.[split];
  return v != null ? v : num(p[split === "wtd" ? "Max WAA wtd" : `Max WAA ${split}`]);
};

export const getMaxWaaP = (p) => {
  const v = p.prospect?.waa?.max;
  return v != null ? v : num(p["MAX WAA P"]);
};

export const getMaxWar = (p, split = "wtd") => {
  const v = p.maxWar?.[split];
  return v != null ? v : num(p[split === "wtd" ? "Max WAR wtd" : `Max WAR ${split}`]);
};

export const getMaxWarP = (p) => {
  const v = p.prospect?.war?.max;
  return v != null ? v : num(p["MAX WAR P"]);
};

export const getBatR = (p, split = "wtd") => {
  const v = p.batting?.[split]?.batR;
  return v != null ? v : num(p[`BatR ${split}`]);
};

export const getBsr = (p, split = "wtd") => {
  const v = p.baserunning?.[split]?.bsr;
  return v != null ? v : num(p[`BSR ${split}`]);
};

export const getSpWaa = (p, split = "wtd") => {
  const isSPEligible = (p.starter ?? parseCSVBoolean(p.Starter)) || (p.starterP ?? parseCSVBoolean(p["Starter P"]));
  if (!isSPEligible) return null;
  const v = p.sp?.[split]?.waa;
  return v != null ? v : num(p[split === "wtd" ? "WAA wtd" : `WAA ${split}`]);
};

export const getRpWaa = (p, split = "wtd") => {
  const v = p.rp?.[split]?.waa;
  return v != null ? v : num(p[split === "wtd" ? "WAA wtd RP" : `WAA ${split} RP`]);
};

export const getSpWaaP = (p) => {
  const isSPEligible = (p.starter ?? parseCSVBoolean(p.Starter)) || (p.starterP ?? parseCSVBoolean(p["Starter P"]));
  if (!isSPEligible) return null;
  const v = p.prospect?.sp?.waa;
  return v != null ? v : num(p["WAP"]);
};

export const getRpWaaP = (p) => {
  const v = p.prospect?.rp?.waa;
  return v != null ? v : num(p["WAP RP"]);
};

export const getSpWar = (p, split = "wtd") => {
  const isSPEligible = (p.starter ?? parseCSVBoolean(p.Starter)) || (p.starterP ?? parseCSVBoolean(p["Starter P"]));
  if (!isSPEligible) return null;
  const v = p.sp?.[split]?.war;
  return v != null ? v : num(p[split === "wtd" ? "WAR wtd" : `WAR ${split}`]);
};

export const getRpWar = (p, split = "wtd") => {
  const v = p.rp?.[split]?.war;
  return v != null ? v : num(p[split === "wtd" ? "WAR wtd RP" : `WAR ${split} RP`]);
};

export const getSpWarP = (p) => {
  const isSPEligible = (p.starter ?? parseCSVBoolean(p.Starter)) || (p.starterP ?? parseCSVBoolean(p["Starter P"]));
  if (!isSPEligible) return null;
  const v = p.prospect?.sp?.war;
  return v != null ? v : num(p["WARP"]);
};

export const getRpWarP = (p) => {
  const v = p.prospect?.rp?.war;
  return v != null ? v : num(p["WARP RP"]);
};

// v16 per-player floor — pipeline-computed via the floor pipeline (developable
// ratings replaced with cohort min, full WAA recomputed). Floor reflects the
// player's value if their bat / pitch tools never developed past minimum, with
// non-developable skills (defense, baserunning, position) intact. Glove-first
// SS naturally has a higher floor than a bat-first 1B at the same cur/pot.
export const getFloorWaa = (p, split = "wtd") => p.floorWaa?.[split] ?? null;
export const getSpFloor = (p) => p.floor?.sp?.waa ?? null;
export const getRpFloor = (p) => p.floor?.rp?.waa ?? null;

export const getFloorWar = (p, split = "wtd") => p.floorWar?.[split] ?? null;
export const getSpFloorWar = (p) => p.floor?.sp?.war ?? null;
export const getRpFloorWar = (p) => p.floor?.rp?.war ?? null;

export const resolveKey = (p, key) => {
  switch (key) {
    case "Max WAA wtd": return getMaxWaa(p, "wtd");
    case "Max WAA vR": return getMaxWaa(p, "vR");
    case "Max WAA vL": return getMaxWaa(p, "vL");
    case "MAX WAA P": return getMaxWaaP(p);
    case "WAA wtd": return getSpWaa(p);
    case "WAA wtd RP": return getRpWaa(p);
    case "WAP": return getSpWaaP(p);
    case "WAP RP": return getRpWaaP(p);
    case "Max WAR wtd": return getMaxWar(p, "wtd");
    case "Max WAR vR": return getMaxWar(p, "vR");
    case "Max WAR vL": return getMaxWar(p, "vL");
    case "MAX WAR P": return getMaxWarP(p);
    case "WAR wtd": return getSpWar(p);
    case "WAR wtd RP": return getRpWar(p);
    case "WARP": return getSpWarP(p);
    case "WARP RP": return getRpWarP(p);
    case "OBP vR": return p.batting?.vR?.obp ?? null;
    case "OBP vL": return p.batting?.vL?.obp ?? null;
    case "wOBA vR": return p.batting?.vR?.woba ?? null;
    case "wOBA vL": return p.batting?.vL?.woba ?? null;
    case "Name": return p.meta?.name ?? p.Name;
    case "POS": return p.meta?.pos ?? p.POS;
    case "ORG": return p.meta?.org ?? p.ORG;
    case "Lev": return p.meta?.lev ?? p.Lev;
    case "Prone": return p.meta?.prone ?? p.Prone;
    case "Price": return p.meta?.price ?? p.Price;
    case "PROY": return p.meta?.proy ?? p.PROY;
    case "B": return p.meta?.bats ?? p.B;
    case "Age": return p._age;
    case "INT": return p.meta?.int ?? p.INT;
    case "WE": return p.meta?.we ?? p.WE;
    case "LEA": return p.meta?.lea ?? p.LEA;
    case "AD": return p.meta?.ad ?? p.AD;
    case "_intangibles": return p._intangibles ?? null;
    case "STM": return p.meta?.stm ?? p.STM;
    case "VELO": return p.meta?.velo ?? p.VELO;
    case "Starter": return p.starter ?? p.Starter;
    case "Starter P": return p.starterP ?? p["Starter P"];
    case "MLD": return p.meta?.mld ?? p.MLD;
    case "OY": return p.meta?.oy ?? p.OY;
    case "OVR": return p.meta?.ovr ?? p.OVR;
    case "POT": return p.meta?.pot ?? p.POT;
    default: return p[key];
  }
};

const POS_SORT_ORDER = { C: 0, "1B": 1, "2B": 2, "3B": 3, SS: 4, LF: 5, CF: 6, RF: 7, DH: 8, SP: 9, RP: 10 };
export { POS_SORT_ORDER };

export const genericSort = (arr, col, dir, specialCols = {}) => {
  const isPosSortCol = col === "POS" || col === "_bestPos";
  const sortOverride = SORT_KEY_OVERRIDE[col];
  arr.sort((a, b) => {
    let va, vb;
    if (specialCols[col]) { va = specialCols[col](a); vb = specialCols[col](b); }
    else if (sortOverride && (a[sortOverride] != null || b[sortOverride] != null)) {
      va = a[sortOverride]; vb = b[sortOverride];
    }
    else {
      const ra = resolveKey(a, col), rb = resolveKey(b, col);
      if (isPosSortCol) {
        const pa = POS_SORT_ORDER[typeof ra === "string" ? ra.replace("*", "") : ra];
        const pb = POS_SORT_ORDER[typeof rb === "string" ? rb.replace("*", "") : rb];
        va = pa ?? 99; vb = pb ?? 99;
      } else {
        const na = num(ra), nb = num(rb);
        if (na != null || nb != null) { va = na; vb = nb; }
        else { va = (ra === "" || ra == null) ? null : ra; vb = (rb === "" || rb == null) ? null : rb; }
      }
    }
    if (va == null && vb == null) return 0;
    if (va == null) return 1; if (vb == null) return -1;
    if (typeof va === "string") return dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    return dir === "asc" ? va - vb : vb - va;
  });
};

// Scale RP WAA/WAA P to SP-equivalent for board ranking and FV computation.
// Only negative values are scaled — positive RP values pass through unchanged.
export const scaleRpWaaP = (v, threshold = RP_SCALE_THRESHOLD) => {
  if (v == null) return null;
  if (v >= 0) return v;
  const ratio = IP_SP / IP_RP; // ~2.667
  if (v <= threshold) return v * ratio;
  const t = v / threshold; // 1.0 at threshold, 0.0 at 0
  return v * (1 + (ratio - 1) * t);
};

// WAR equivalent — identical scaling logic. Replacement-level WAR for RP
// is still 0, so "negative WAR" still means "below replacement" — the same
// negative-only ramp applies.
export const scaleRpWarP = scaleRpWaaP;

// Best-of-role decision for a pitcher. Returns:
//   role        — 'sp' or 'rp'
//   war,warP    — RAW WAR values for display (positive RP unscaled per scaleRpWarP rule)
//   warSort     — scaled-to-SP WAR, used as sort key (rp -> scaled, sp -> raw)
//   warPSort    — scaled-to-SP WAR P, used as sort key
//   floorSort   — scaled-to-SP floor WAR (for the chosen role) — vestigial
//   devPct      — pitcher's percentile of cur-WAR within age cohort (from devCurves[role])
//   devCurve    — the cohort dev curve used for percentile lookup
//   fv          — always on SP scale (RP FV is computed from scaled inputs)
//
// roleHint: 'best' (default) | 'sp' | 'rp'. 'sp' falls back to RP if the
// player has no SP eligibility data.
//
// devCurves: optional `{sp, rp}` from `data.meta.devCurve` (now WAR-keyed,
// see model/src/export.py). When supplied (with curveSettings), `devPct`
// and `fv` are computed. Without them, `fv` falls back to `warSort`.
//
// Why WAR (not WAA): WAR's replacement-runs term gives SPs ~3× more credit
// than RPs at full-time IP, which is the structural fix for SP-vs-RP value
// comparisons. Best-role decision now uses WAR P, which means more SPs win
// the SP-vs-RP race for their best role.
export const pickPitcherRole = (p, devCurves = null, curveSettings = null, roleHint = 'best') => {
  const spWar = getSpWar(p);
  const spWarP = getSpWarP(p);
  const rpWar = getRpWar(p);
  const rpWarP = getRpWarP(p);
  const rpWarScaled = scaleRpWarP(rpWar);
  const rpWarPScaled = scaleRpWarP(rpWarP);
  const spFloor = getSpFloorWar(p);
  const rpFloorScaled = scaleRpWarP(getRpFloorWar(p));

  let useRp;
  if (roleHint === 'rp') {
    useRp = true;
  } else if (roleHint === 'sp') {
    useRp = (spWar == null && spWarP == null);
  } else {
    useRp = (spWarP == null) || (rpWarPScaled != null && rpWarPScaled > spWarP);
  }

  const role = useRp ? 'rp' : 'sp';
  const cur = useRp ? rpWarScaled : spWar;
  const pot = useRp ? rpWarPScaled : spWarP;
  const floor = useRp ? rpFloorScaled : spFloor;

  const devCurve = devCurves ? (useRp ? devCurves.rp : devCurves.sp) : null;
  // devPct kept as a metadata field for diagnostic display (Dev% column,
  // FVIAT subtext) but no longer enters the FV formula in v21.
  const devPct = (cur != null && devCurve != null) ? devPercentileRank(devCurve, p._age, cur) : null;
  let fv = cur;
  if (cur != null && curveSettings) {
    fv = calcFutureValue(cur, pot, p._age, curveSettings);
  }

  return {
    role,
    war: useRp ? rpWar : spWar,
    warP: useRp ? rpWarP : spWarP,
    warSort: cur,
    warPSort: pot,
    floorSort: floor,
    devPct,
    devCurve,
    fv,
  };
};

export const getBestPitcherWar = (p) => pickPitcherRole(p).war;
export const getBestPitcherWarP = (p) => pickPitcherRole(p).warP;
export const getBestPitcherFv = (p, progressCurves, cs) => pickPitcherRole(p, progressCurves, cs).fv;

// Map *consolidated* WAR / WAR P column names to companion sort keys. When sorting
// one of these columns, helpers prefer the *Sort key (scaled-to-SP equivalent) so
// RP-best rows sort by their SP-equivalent value even though the displayed cell is
// the raw RP value. Role-specific column keys ("WAR wtd", "WARP", etc.) intentionally
// sort by their own role and do NOT appear here.
export const SORT_KEY_OVERRIDE = {
  war: "_warSort",
  warP: "_warPSort",
  _war: "_warSort",
  _warP: "_warPSort",
};

export const blendPlatoon = (vR, vL, hand, splits, type) => {
  const r = num(vR), l = num(vL);
  if (r == null && l == null) return null;
  if (r == null) return l;
  if (l == null) return r;
  const baseKey = (hand === "L" || hand === "R" || hand === "S") ? hand : "OVR";
  const w = splits?.[type]?.[baseKey] ?? splits?.[type]?.["OVR"] ?? { vR: 0.62, vL: 0.38 };
  return r * w.vR + l * w.vL;
};
