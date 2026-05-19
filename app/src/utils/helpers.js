// ============================================================================
// HELPERS — Formatting, search, pagination, roster row utilities
// ============================================================================
import { getMaxWar, getMaxWarP, POS_SORT_ORDER, pickPitcherRole, SORT_KEY_OVERRIDE } from "./accessors.js";
import { LEVELS_ORDER } from "./constants.js";

export const num = (v) => {
  if (v == null || v === "" || v === "-") return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

export const fmt = (v, d = 2) => (v == null || isNaN(v) ? "—" : v.toFixed(d));

export const fmtAge = (v) => {
  if (v == null || isNaN(v)) return "—";
  return (Math.floor(v * 10) / 10).toFixed(1);
};

export const fmtMLD = (v) => { const d = num(v); if (d == null) return "—"; const yrs = Math.floor(d / 172); const rem = d - yrs * 172; return `${yrs}.${String(rem).padStart(3, "0")}`; };

export function fmtSalary(v) {
  if (v == null || v <= 0) return null;
  if (v >= 1000000) return `$${(v / 1000000).toFixed(v % 1000000 === 0 ? 0 : 1)}M`;
  if (v >= 1000) return `$${Math.round(v / 1000)}K`;
  return `$${v}`;
}

export const parseCSVBoolean = (v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true" || v === "Yes";
  return false;
};

export const isTrueFA = (p, iafaTag) => { const org = p.meta?.org ?? p.ORG; if (org !== "-") return false; const m = (p.meta?.source ?? p.meta?.manual ?? p.Manual ?? "").trim(); return m !== (iafaTag || "IAFA") && !m.toLowerCase().includes("draft"); };

export const orgLabel = (p, iafaTag) => { const org = (p.meta?.org ?? p.ORG ?? "").trim(); if (org && org !== "-" && org !== "0") return org; const m = (p.meta?.source ?? p.meta?.manual ?? p.Manual ?? "").trim(); if (m === (iafaTag || "IAFA")) return m; if (m.toLowerCase().includes("draft")) { const yr = m.match(/\d{4}/); return yr ? yr[0] + " Draft" : "Draft"; } return "FA"; };

export const rankSuffix = (n) => {
  if (n === null) return "—";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export function searchFilter(rows, search) {
  if (!search) return rows;
  const s = search.toLowerCase();
  return rows.filter((r) => (r.meta?.name ?? r.Name)?.toLowerCase().includes(s));
}

export function paginateRows(rows, page, perPage) {
  return { paged: rows.slice(page * perPage, (page + 1) * perPage), totalPages: Math.ceil(rows.length / perPage) };
}

// roleHint: 'best' (default — use enrichment fields), 'sp', or 'rp'.
// progressCurves + curveSettings only required when roleHint forces a non-default
// role (e.g. SP-only / RP-only filters) so FV gets recomputed for that role.
export const toRosterRow = (p, type, extras = {}, roleHint = 'best', curveSettings = null, progressCurves = null) => {
  const pos = p.meta?.pos ?? p.POS;
  const isPitcher = type === "pitcher";
  const r = (isPitcher && roleHint && roleHint !== 'best')
    ? pickPitcherRole(p, progressCurves, curveSettings, roleHint)
    : null;
  const hitWar = type === "hitter" ? getMaxWar(p) : null;
  const hitWarP = type === "hitter" ? getMaxWarP(p) : null;
  return {
    id: p._uid, name: p.meta?.name ?? p.Name, age: p._age,
    pos, bestPos: p._bestPos,
    bt: `${p.meta?.bats ?? p.B ?? ""}/${p.meta?.throws ?? p.T ?? ""}`,
    level: p.meta?.lev ?? p.Lev, prone: p.meta?.prone ?? p.Prone,
    war: type === "hitter" ? hitWar : (r?.war ?? p._war),
    warP: type === "hitter" ? hitWarP : (r?.warP ?? p._warP),
    _warSort: type === "hitter" ? hitWar : (r?.warSort ?? p._warSort),
    _warPSort: type === "hitter" ? hitWarP : (r?.warPSort ?? p._warPSort),
    _role: isPitcher ? (r?.role ?? p._role) : null,
    fv: r?.fv ?? p._fv,
    devPct: p._devPct, matured: p._matured,
    type, _twoWay: p._twoWay, _type: p._type, _original: p,
    ...extras,
  };
};

const INT_WEIGHTS = { lea: 0.15, loy: 0.10, ad: 0.05, fin: 0.10, we: 0.35, int: 0.25 };
const INT_INVERTED = new Set(["fin"]);
function intangibleFieldScore(key, val) {
  if (!val || val === "-") return null;
  if (val === "H") return INT_INVERTED.has(key) ? 4 : 17;
  if (val === "L") return INT_INVERTED.has(key) ? 17 : 4;
  if (val === "N") return 10;
  return null;
}
export function calcRawIntangibles(player) {
  const m = player.meta || {};
  let wSum = 0, wTotal = 0;
  for (const [k, w] of Object.entries(INT_WEIGHTS)) {
    const val = m[k] ?? player[k.toUpperCase()];
    const s = intangibleFieldScore(k, val);
    if (s != null) { wSum += s * w; wTotal += w; }
  }
  return wTotal === 0 ? null : wSum / wTotal;
}

export function sortRosterRows(rows, col, dir, colMap) {
  const sortOverride = SORT_KEY_OVERRIDE[col];
  rows.sort((a, b) => {
    let va, vb;
    if (colMap?.[col]) {
      va = colMap[col](a); vb = colMap[col](b);
    } else if (sortOverride && (a[sortOverride] != null || b[sortOverride] != null)) {
      va = a[sortOverride]; vb = b[sortOverride];
    } else {
      va = a[col]; vb = b[col];
    }
    if (col === "level") { va = LEVELS_ORDER[a.level] ?? 99; vb = LEVELS_ORDER[b.level] ?? 99; }
    if (col === "pos" || col === "bestPos") { va = POS_SORT_ORDER[typeof va === "string" ? va.replace("*", "") : va] ?? 99; vb = POS_SORT_ORDER[typeof vb === "string" ? vb.replace("*", "") : vb] ?? 99; }
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string") return dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    return dir === "asc" ? va - vb : vb - va;
  });
}
