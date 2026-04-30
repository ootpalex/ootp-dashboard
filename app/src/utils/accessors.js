// ============================================================================
// ACCESSORS — Data accessor functions, resolveKey, genericSort
// ============================================================================
import { num, parseCSVBoolean } from "./helpers.js";
import { IP_SP, IP_RP, RP_SCALE_THRESHOLD } from "./constants.js";
import { calcFutureValue } from "./futureValue.js";

export const getWaa = (p, pos, split = "wtd") => {
  const v = p.positions?.[pos.toLowerCase()]?.waa?.[split];
  return v != null ? v : num(p[`${pos} WAA ${split}`]);
};

export const getWaaP = (p, pos) => {
  const v = p.prospect?.waa?.[pos.toLowerCase()];
  return v != null ? v : num(p[`${pos} WAA P`]);
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
// return { waa, waaP, fv } using the best eligible matching position's values.
// devPct + curveSettings optional — when provided, computes FV; otherwise fv = waa.
// Returns null if the player is not eligible at any matching position.
export const pickFielderPos = (p, posHint, devPct = null, curveSettings = null) => {
  if (!posHint) return null;
  const positions = _expandFieldPositions(posHint);
  if (!positions.length) return null;
  const eligible = positions.filter((pos) => isEligible(p, pos));
  if (!eligible.length) return null;
  let bestWaa = null, bestWaaP = null;
  for (const pos of eligible) {
    const w = getWaa(p, pos);
    const wp = getWaaP(p, pos);
    if (w != null && (bestWaa == null || w > bestWaa)) bestWaa = w;
    if (wp != null && (bestWaaP == null || wp > bestWaaP)) bestWaaP = wp;
  }
  const fv = bestWaa != null && devPct != null && curveSettings != null
    ? calcFutureValue(bestWaa, bestWaaP, p._age, devPct, curveSettings)
    : bestWaa;
  return { waa: bestWaa, waaP: bestWaaP, fv };
};

// Eligibility-based membership check for the unified position filter.
// Accepts a single string or an array of selections. Empty / null / "ALL" =
// pass. Multi-select uses OR semantics.
const _matchesSinglePosFilter = (p, posFilter) => {
  const isPitcher = p._type === "pitcher" || p._poolType === "pitcher";
  if (posFilter === "Pitchers") return isPitcher;
  if (posFilter === "Hitters") return !isPitcher;
  if (posFilter === "SP") return isPitcher && getSpWaa(p) != null;
  if (posFilter === "RP") return isPitcher && getSpWaa(p) == null;
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

// Best-of-role decision for a pitcher. Returns:
//   role     — 'sp' or 'rp'
//   waa,waaP — RAW values for display (positive RP unscaled per scaleRpWaaP rule)
//   waaSort  — scaled-to-SP WAA, used as sort key (rp -> scaled, sp -> raw)
//   waaPSort — scaled-to-SP WAA P, used as sort key
//   fv       — always on SP scale (RP FV is computed from scaled inputs)
// roleHint: 'best' (default) | 'sp' | 'rp'.
//   'sp' falls back to RP if the player has no SP eligibility data.
export const pickPitcherRole = (p, devPct, curveSettings, roleHint = 'best') => {
  const spWaa = getSpWaa(p);
  const spWaaP = getSpWaaP(p);
  const rpWaa = getRpWaa(p);
  const rpWaaP = getRpWaaP(p);
  const rpWaaScaled = scaleRpWaaP(rpWaa);
  const rpWaaPScaled = scaleRpWaaP(rpWaaP);

  let useRp;
  if (roleHint === 'rp') {
    useRp = true;
  } else if (roleHint === 'sp') {
    useRp = (spWaa == null && spWaaP == null);
  } else {
    useRp = (spWaaP == null) || (rpWaaPScaled != null && rpWaaPScaled > spWaaP);
  }

  const fvFor = (cur, pot) => {
    if (cur == null) return null;
    if (devPct == null || curveSettings == null) return cur;
    return calcFutureValue(cur, pot, p._age, devPct, curveSettings);
  };

  if (useRp) {
    return {
      role: 'rp',
      waa: rpWaa,
      waaP: rpWaaP,
      waaSort: rpWaaScaled,
      waaPSort: rpWaaPScaled,
      fv: fvFor(rpWaaScaled, rpWaaPScaled),
    };
  }
  return {
    role: 'sp',
    waa: spWaa,
    waaP: spWaaP,
    waaSort: spWaa,
    waaPSort: spWaaP,
    fv: fvFor(spWaa, spWaaP),
  };
};

export const getBestPitcherWaa = (p) => pickPitcherRole(p).waa;
export const getBestPitcherWaaP = (p) => pickPitcherRole(p).waaP;
export const getBestPitcherFv = (p, devPct, cs) => pickPitcherRole(p, devPct, cs).fv;

// Map *consolidated* WAA / WAA P column names to companion sort keys. When sorting
// one of these columns, helpers prefer the *Sort key (scaled-to-SP equivalent) so
// RP-best rows sort by their SP-equivalent value even though the displayed cell is
// the raw RP value. Role-specific column keys ("WAA wtd", "WAP", etc.) intentionally
// sort by their own role and do NOT appear here.
export const SORT_KEY_OVERRIDE = {
  waa: "_waaSort",
  waaP: "_waaPSort",
  _waa: "_waaSort",
  _waaP: "_waaPSort",
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
