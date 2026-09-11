// ============================================================================
// SPLITS — L/R platoon-split DIRECTION profiling
// ============================================================================
// OOTP rates every hitter and pitcher separately vs LHP and vs RHP. Almost
// every player's ratings all lean the same way (a RHB is better vs LHP at all
// six hitting attributes, a LHP is better vs LHB at all five pitching ones),
// because the platoon advantage that drives the split is a single underlying
// trait. A "mixed" player — better vs L at one attribute and better vs R at
// another — is the rare exception worth being able to search for.
//
// Every OOTP rating on this scale reads higher = better (K = avoid strikeouts,
// HRR = HR allowed, PBABIP = BABIP allowed), so a plain numeric comparison per
// attribute gives the direction without any per-attribute inversion.
//
// WHICH RATINGS — `ratings.vL` / `ratings.vR` are NOT the 20-80 grades OOTP
// shows: they are the pipeline's scout + OSA + AAA/AA blends, landing anywhere
// on a de-quantized 18-80 scale. Blending a pair of grades that are EQUAL
// in-game routinely produces a 1-2 point gap, which reads as a reverse platoon
// split that does not exist — on the default league a bare `>` over the blends
// calls 8.1% of pitchers mixed against 0.6% in the raw scout export. So the
// profile prefers `ratings.scouted`, the as-scouted grades the pipeline
// snapshots before either blend, and compares those exactly.
//
// Dashboards built before that snapshot landed have no `ratings.scouted`. There
// the blends are all we have, and a tie threshold is the only defence: rounding
// a blend back to its grade recovers the scouted value for just 92.6% of hitter
// split ratings (audited by ID against the raw export — the AAA/AA blend can
// move a rating more than half a bucket), while requiring a 2-point gap
// reproduces the raw-export profile mix closely. Rebuilding the league is what
// makes the search exact; the fallback only keeps a stale dashboard sane.
import { num } from "./helpers.js";

// Minimum gap between two BLENDED ratings before an attribute counts as leaning.
// Unused when a player carries as-scouted grades — those compare exactly.
export const BLENDED_SPLIT_MIN_GAP = 2;

export const HITTER_SPLIT_ATTRS = [
  { key: "ba", label: "BABIP", col: "BA" },
  { key: "con", label: "CON", col: "CON" },
  { key: "gap", label: "GAP", col: "GAP" },
  { key: "pow", label: "POW", col: "POW" },
  { key: "eye", label: "EYE", col: "EYE" },
  { key: "k", label: "K", col: "K" },
];

export const PITCHER_SPLIT_ATTRS = [
  { key: "stu", label: "STU", col: "STU" },
  { key: "mov", label: "MOV", col: "MOV" },
  { key: "pcon", label: "CON", col: "PCON" },
  { key: "pbabip", label: "BABIP", col: "PBABIP" },
  { key: "hrr", label: "HRR", col: "HRR" },
];

// Split-profile categories, in the order they're offered in the filter.
export const SPLIT_PROFILE_OPTIONS = [
  { value: "mixed", label: "Mixed (reverse attribute)" },
  { value: "vL", label: "Uniformly better vs LHP" },
  { value: "vR", label: "Uniformly better vs RHP" },
  { value: "even", label: "No split (all tied)" },
];

// A player carries pitcher split ratings if his ratings block has the pitcher
// keys — true for the pitcher-side record of a two-way player as well.
export function splitAttrsFor(p) {
  const r = p?.ratings;
  if (r?.vR?.stu != null || r?.vL?.stu != null || r?.scouted?.vR?.stu != null) return PITCHER_SPLIT_ATTRS;
  if (r?.vR?.ba != null || r?.vL?.ba != null || r?.scouted?.vR?.ba != null) return HITTER_SPLIT_ATTRS;
  // Legacy flat-CSV rows (no nested `ratings`) — fall back to the record type.
  return (p?._type ?? p?._poolType) === "pitcher" ? PITCHER_SPLIT_ATTRS : HITTER_SPLIT_ATTRS;
}

// Grades to profile on, plus the gap they need before an attribute leans:
// as-scouted grades are exact (any difference is one OOTP shows), blends are not.
// The flat-column fallback is for legacy CSV-upload rows only — never mixed in
// alongside a nested `ratings` block, whose two scales must not be compared.
function splitSource(p) {
  const ratings = p?.ratings;
  const scouted = ratings?.scouted;
  if (scouted?.vL || scouted?.vR) return { of: (s) => scouted?.[s], minGap: 1, flat: false };
  if (ratings?.vL || ratings?.vR) return { of: (s) => ratings?.[s], minGap: BLENDED_SPLIT_MIN_GAP, flat: false };
  return { of: () => undefined, minGap: BLENDED_SPLIT_MIN_GAP, flat: true };
}

const ratingFor = (src, p, attr, split) =>
  num(src.flat ? p?.[`${attr.col} ${split}`] : src.of(split)?.[attr.key]);

/**
 * Classify one player's per-attribute split directions.
 *
 * Returns null when the player has no usable split ratings at all. Otherwise:
 *   tilt        "vL" | "vR"  — every non-tied attribute leans the same way
 *               "mixed"      — at least one attribute each way
 *               "even"       — every rated attribute is tied
 *   betterVsL / betterVsR / tied   attribute descriptors in each bucket
 *   odd         the minority-side attributes of a mixed player (the ones that
 *               buck his overall lean), empty for every other tilt
 */
export function splitProfile(p) {
  const attrs = splitAttrsFor(p);
  const src = splitSource(p);
  const minGap = src.minGap;
  const betterVsL = [], betterVsR = [], tied = [];
  for (const a of attrs) {
    const l = ratingFor(src, p, a, "vL");
    const r = ratingFor(src, p, a, "vR");
    if (l == null || r == null) continue;
    if (l - r >= minGap) betterVsL.push(a);
    else if (r - l >= minGap) betterVsR.push(a);
    else tied.push(a);
  }
  const rated = betterVsL.length + betterVsR.length + tied.length;
  if (rated === 0) return null;
  let tilt, odd = [];
  if (betterVsL.length && betterVsR.length) {
    tilt = "mixed";
    odd = betterVsL.length <= betterVsR.length ? betterVsL : betterVsR;
  } else if (betterVsL.length) tilt = "vL";
  else if (betterVsR.length) tilt = "vR";
  else tilt = "even";
  return { tilt, betterVsL, betterVsR, tied, odd, rated };
}

/** Short table/label text for a profile, e.g. "vL · EYE vR". */
export function splitLabel(profile) {
  if (!profile) return "—";
  if (profile.tilt === "even") return "even";
  if (profile.tilt !== "mixed") return profile.tilt;
  const oddIsL = profile.odd === profile.betterVsL;
  const major = oddIsL ? "vR" : "vL";
  const minor = oddIsL ? "vL" : "vR";
  return `${major} · ${profile.odd.map((a) => a.label).join("/")} ${minor}`;
}

/** True when `p` matches any of the selected profile values (empty = no filter). */
export function passesSplitFilter(p, selected) {
  if (!selected || selected.length === 0) return true;
  const profile = splitProfile(p);
  return profile != null && selected.includes(profile.tilt);
}

/**
 * Tally split profiles across a pool.
 * Returns { rated, mixed, vL, vR, even, oddAttrs } where `oddAttrs` counts how
 * often each attribute is the one bucking a mixed player's lean.
 */
export function summarizeSplits(rows) {
  const out = { rated: 0, mixed: 0, vL: 0, vR: 0, even: 0, oddAttrs: {} };
  for (const r of rows) {
    const profile = splitProfile(r);
    if (!profile) continue;
    out.rated += 1;
    out[profile.tilt] += 1;
    for (const a of profile.odd) out.oddAttrs[a.label] = (out.oddAttrs[a.label] ?? 0) + 1;
  }
  return out;
}
