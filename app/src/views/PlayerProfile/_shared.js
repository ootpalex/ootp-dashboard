// Shared helpers for the redesigned PlayerProfile modal:
// - leaguePercentile: rank-based (sorted-array) percentile, 0–100
// - peer-pool builders for hitters and pitchers
// - value-component getters that centralize the BatR / BSR / RunsP / WAA reads
// - fmtSalary: re-exported from utils/helpers.js for tab use
import { num } from "../../utils/helpers.js";
import {
  getMaxWaa,
  getMaxWaaP,
  getBatR,
  getBsr,
  getRunsP,
  getSpWaa,
  getSpWaaP,
  getRpWaa,
  getRpWaaP,
  isEligible,
} from "../../utils/accessors.js";
import { POS_DEF_ADJ } from "../../utils/constants.js";

export { fmtSalary } from "../../utils/helpers.js";

// Ascending-sorted pool, nulls already stripped. Returns 0–100 integer percentile,
// or null if value or pool is missing. Mid-rank handles ties.
export function leaguePercentile(value, sortedAsc, { invert = false } = {}) {
  if (value == null || !sortedAsc || sortedAsc.length === 0) return null;
  const n = sortedAsc.length;
  let lo = 0, hi = n;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (sortedAsc[m] < value) lo = m + 1;
    else hi = m;
  }
  const below = lo;
  let lo2 = below, hi2 = n;
  while (lo2 < hi2) {
    const m = (lo2 + hi2) >> 1;
    if (sortedAsc[m] <= value) lo2 = m + 1;
    else hi2 = m;
  }
  const equalEnd = lo2;
  const midRank = (below + equalEnd) / 2;
  const pct = Math.round((midRank / n) * 100);
  return invert ? 100 - pct : pct;
}

// Sort, strip nulls/NaNs.
function sortPool(values) {
  return values
    .filter((v) => v != null && !Number.isNaN(v))
    .sort((a, b) => a - b);
}

// Best fielding value across eligible positions: RunsP + positional adjustment.
function bestFieldingValue(player) {
  let best = null;
  for (const pos of ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"]) {
    if (!isEligible(player, pos)) continue;
    const v = getRunsP(player, pos);
    if (v == null) continue;
    const adj = v + (POS_DEF_ADJ[pos] ?? 0);
    if (best == null || adj > best) best = adj;
  }
  return best;
}

// Build hitter peer pools, filtered to MLB-level (matches the previous radar's pool).
// Returns {overall, batting, fielding, baserunning} each with a {current, potential}
// pair of ascending-sorted numeric arrays. Single-dot metrics (fielding, baserunning)
// expose only `current`.
export function buildHitterPeerPools(hitters) {
  const mlb = (hitters || []).filter((h) => (h.meta?.lev ?? h.Lev) === "MLB");
  return {
    overall: {
      current: sortPool(mlb.map((h) => getMaxWaa(h))),
      potential: sortPool(mlb.map((h) => getMaxWaaP(h))),
    },
    batting: {
      current: sortPool(mlb.map((h) => getBatR(h))),
      potential: sortPool(mlb.map((h) => num(h.prospect?.batting?.batR))),
    },
    fielding: {
      current: sortPool(mlb.map((h) => bestFieldingValue(h))),
    },
    baserunning: {
      current: sortPool(mlb.map((h) => getBsr(h))),
      potential: sortPool(mlb.map((h) => num(h.prospect?.baserunning?.bsr))),
    },
  };
}

// Pitcher peer pools — filtered to MLB level and (for SP) SP-eligible. Returns
// {overall, k, bb, hr, babip} with current/potential arrays.
//
// Counts (so/ubb/hr) are monotonic with the corresponding rate because every
// projected pitcher is normalized to IP_SP / IP_RP, so percentile-by-count
// equals percentile-by-rate.
export function buildPitcherPeerPools(pitchers, role) {
  const mlb = (pitchers || []).filter((p) => (p.meta?.lev ?? p.Lev) === "MLB");
  const pool = role === "sp" ? mlb.filter((p) => getSpWaa(p) != null) : mlb;

  const cur = (p) => p?.[role]?.wtd ?? null;
  const pot = (p) => p?.prospect?.[role] ?? null;

  // BABIP-against = (1B + 2B + 3B) / (BF − SO − uBB − HR − HBP).
  // For prospect we don't ship 1B/2B/3B, so prospect BABIP isn't computable;
  // single-dot only for that metric.
  const babipAgainst = (s) => {
    if (!s) return null;
    const singles = num(s.singles), doubles = num(s.doubles), triples = num(s.triples);
    const so = num(s.so), ubb = num(s.ubb), hr = num(s.hr), hbp = num(s.hbp ?? 0);
    if (singles == null || doubles == null || triples == null) return null;
    if (so == null || ubb == null || hr == null) return null;
    // Recover BF from a wOBA-shaped sum: events + outs. We don't have outs
    // explicitly, so use league-typical PA/IP ≈ 4.18 against the role's IP.
    // Result is a relative measure — only the ranking matters.
    const hits = singles + doubles + triples;
    const events = so + ubb + hr + hbp + hits;
    if (events <= 0) return null;
    const ipsr = role === "sp" ? 185.47 : 69.55; // matches IP_SP / IP_RP
    const bf = ipsr * 4.18;
    const bip = Math.max(1, bf - so - ubb - hr - hbp);
    return hits / bip;
  };

  return {
    overall: {
      current: sortPool(pool.map((p) => num(cur(p)?.waa))),
      potential: sortPool(pool.map((p) => num(pot(p)?.waa))),
    },
    k: {
      current: sortPool(pool.map((p) => num(cur(p)?.so))),
      potential: sortPool(pool.map((p) => num(pot(p)?.so))),
    },
    bb: {
      current: sortPool(pool.map((p) => num(cur(p)?.ubb))),
      potential: sortPool(pool.map((p) => num(pot(p)?.ubb))),
    },
    hr: {
      current: sortPool(pool.map((p) => num(cur(p)?.hr))),
      potential: sortPool(pool.map((p) => num(pot(p)?.hr))),
    },
    babip: {
      current: sortPool(pool.map((p) => babipAgainst(cur(p)))),
    },
  };
}

// Hitter component values for the percentile header. Each entry: { current, potential? }.
export function getHitterValueComponents(player) {
  return {
    overall: {
      current: getMaxWaa(player),
      potential: getMaxWaaP(player),
    },
    batting: {
      current: getBatR(player),
      potential: num(player.prospect?.batting?.batR),
    },
    fielding: {
      current: bestFieldingValue(player),
    },
    baserunning: {
      current: getBsr(player),
      potential: num(player.prospect?.baserunning?.bsr),
    },
  };
}

// Pitcher component values for the given role. Counts (so/ubb/hr) are role-normalized,
// so they're already comparable to the role pool.
export function getPitcherValueComponents(player, role) {
  const cur = player?.[role]?.wtd ?? null;
  const pot = player?.prospect?.[role] ?? null;
  const overallCur = role === "sp" ? getSpWaa(player) : getRpWaa(player);
  const overallPot = role === "sp" ? getSpWaaP(player) : getRpWaaP(player);

  // BABIP-against — current only (prospects don't ship 1B/2B/3B counts).
  let babipCur = null;
  if (cur) {
    const singles = num(cur.singles), doubles = num(cur.doubles), triples = num(cur.triples);
    const so = num(cur.so), ubb = num(cur.ubb), hr = num(cur.hr), hbp = num(cur.hbp ?? 0);
    if (singles != null && doubles != null && triples != null && so != null && ubb != null && hr != null) {
      const ipsr = role === "sp" ? 185.47 : 69.55;
      const bf = ipsr * 4.18;
      const bip = Math.max(1, bf - so - ubb - hr - hbp);
      const hits = singles + doubles + triples;
      babipCur = hits / bip;
    }
  }

  return {
    overall: {
      current: overallCur,
      potential: overallPot,
    },
    k: {
      current: num(cur?.so),
      potential: num(pot?.so),
    },
    bb: {
      current: num(cur?.ubb),
      potential: num(pot?.ubb),
    },
    hr: {
      current: num(cur?.hr),
      potential: num(pot?.hr),
    },
    babip: {
      current: babipCur,
    },
  };
}
