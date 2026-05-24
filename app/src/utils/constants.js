// ============================================================================
// CONSTANTS & CONFIG
// ============================================================================

export const UNAFFILIATED = new Set(["-"]);
export const STATSPLUS_PROXY = "/statsplus";

export const LEAGUE_SETTINGS_KEY = "league_settings";
export const DEFAULT_LEAGUE_SETTINGS = {
  leagueName: "SSB",
  statsplusUrl: "https://atl-01.statsplus.net/ssb/",
  manualExclusions: [],
  manualInclusions: [],
  iafaTag: "IAFA",
  draftDemands: false,
  draftBudget: 0,
};

export const HITTER_POS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];
export const ALL_DISPLAY_POS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH", "SP", "RP"];
export const POS_DEF_ADJ = { C: 12.84, SS: 11.97, "2B": 5.65, "3B": 1.08, CF: -4.41, LF: -7.16, RF: -7.16, "1B": -8.12 };
export const POT_DISPLAY_POS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "SP", "RP"];
export const DEF_SPECTRUM = ["C", "SS", "CF", "2B", "3B", "LF", "RF", "1B", "DH"];
export const DEF_SPECTRUM_POT = ["C", "SS", "CF", "2B", "3B", "LF", "RF", "1B"];

export const DEPTH_N = { C: 4, "1B": 3, "2B": 3, "3B": 3, SS: 3, LF: 3, CF: 3, RF: 3, DH: 2, SP: 8, RP: 6 };
export const DEPTH_N_POT = { C: 4, "1B": 3, "2B": 3, "3B": 3, SS: 3, LF: 3, CF: 3, RF: 3, SP: 10, RP: 8 };
export const ACTIVE_ROSTER_DEPTH = { C: 1, "1B": 1, "2B": 1, "3B": 1, SS: 1, LF: 1, CF: 1, RF: 1, DH: 1, SP: 5, RP: 8 };

// Positional-strength slot weights = empirical share of a position's playing time
// taken by the 1st/2nd/3rd... player on the depth chart. The strength engine
// (utils/strength.js) weights each depth slot's WAR by these so a starter
// dominates, depth contributes with diminishing weight, and deep scrubs ~vanish.
//
// DATA-DERIVED (not hand-picked): mean defensive-innings ("IP Clean") share by
// depth rank, pooled across unique team-seasons in leagues/*/metadata/ (BLM +
// default, n≈58; the four identical BLM-* exports deduped, ORG="-" excluded).
// The MEAN is intentional — the share distribution is left-skewed (healthy
// starter ~0.74-0.82 median, but a ~30% injury/platoon tail pulls the mean to
// ~0.67-0.74), so it's already moderately conservative / depth-favoring.
// SP comes out flat-across-the-rotation + steep depth tail; RP a gentle decay.
// Recompute as more leagues arrive: `python model/tools/compute_slot_shares.py`.
// Keys are lowercase to match the nested-JSON position accessors.
export const SLOT_SHARES = {
  hit: {
    c:    [0.674, 0.283, 0.038, 0.005],
    "1b": [0.698, 0.189, 0.066, 0.029, 0.012],
    "2b": [0.680, 0.208, 0.070, 0.028, 0.010],
    "3b": [0.686, 0.224, 0.063, 0.018, 0.006],
    ss:   [0.738, 0.169, 0.063, 0.019, 0.007],
    lf:   [0.664, 0.204, 0.077, 0.031, 0.014],
    cf:   [0.697, 0.206, 0.064, 0.024, 0.006],
    rf:   [0.705, 0.185, 0.071, 0.023, 0.009],
  },
  sp: [0.244, 0.229, 0.195, 0.163, 0.103, 0.036, 0.016, 0.008],
  rp: [0.224, 0.172, 0.149, 0.121, 0.096, 0.079, 0.054],
};

// Aging-core / future-need detection (utils/decline.js + utils/strength.js).
// FV alone can't flag an aging core — it never declines a 27+ player. So the
// strength engine separately projects each NOW contributor forward `horizon`
// years along a standard decline curve; a position that is league-average-or
// -better today but loses >= futureNeedDropFrac of its value over the horizon
// is flagged as an aging core (a future need despite looking fine now).
export const AGING = {
  horizon: 3,
  futureNeedDropFrac: 0.15,
};

export const LEVELS_ORDER = { "MLB": 0, "AAA": 1, "AA": 2, "A+": 3, "A": 4, "R": 5, "INT": 6, "-": 7 };
export const LEVEL_FILTERS = ["ALL", "MLB", "AAA", "AA", "A+", "A", "R", "INT"];
export const PER_PAGE = 50;
export const PER_PAGE_LARGE = 100;

// v21 — Three-input simplification with power-law creditAge (round curve).
//   gap        = max(0, pot − cur)
//   t          = clamp((age − 14) / (maxCurrentAge − 14), 0, 1)
//   creditAge  = max(0, gapMax × (1 − t^gapExp))
//   FV         = (age ≥ maxCurrentAge) ? cur :
//                (cur > pot)           ? cur :
//                                        cur + gap × creditAge
//
// Drops devPct from the formula: pot is the *ceiling* (max valuation at maturity)
// and (cur, pot, age) encode the per-player spread. The power-law form gives a
// smooth round decay from gapMax at 14 to 0 at maxCurrentAge — preferred over
// the logistic for prospect ranking even though it diverges from the empirical
// median dev curve in the 19–22 window. (Empirical median tracks "typical
// trajectory"; high-pot prospects don't follow median, so the smoother round
// decay credits late-developing upside more naturally.)
export const DEV_CURVE_DEFAULTS = {
  gapMax: 0.80,
  gapExp: 3,
  maxCurrentAge: 27,
  bandwidth: 0.5,
};

export const DEV_CURVE_RANGES = {
  gapMax:        { min: 0.65, max: 1.00, step: 0.05 },
  gapExp:        { min: 1,    max: 8,    step: 1    },
  maxCurrentAge: { min: 26,   max: 27,   step: 1    },
  bandwidth:     { min: 0.1,  max: 1.5,  step: 0.05 },
};

// Position-cap TREE (2026-05-23) — caps derived from the 26-man MLB roster you're
// trying to fill. Each capped node carries its roster count; SOFT cap pct =
// roster/26 (the roster share / target), HARD cap pct = soft × CAP_HARD_MULT
// (+20%, the "normal talent overage" buffer since you can't draft exactly to
// need). SP/MI/CF are no-max (failed starters become RP; up-the-middle shifts
// down the spectrum) and bind only via their parent. Integer caps =
// ceil(pct × totalPicks). A pick counts into its leaf AND every ancestor; its
// penalty is the MAX over the chain of a two-tier per-player rule (see
// SMART_RANK_TUNING / capGroupPenalty). Roster: P13{SP5,RP8} / H13{C2,
// INF6{MI3,1B1,3B1}, OF5{CF2,cOF2}}. Validated via Leftovers/draft-cap-sim/.
export const ROSTER_SIZE = 26;
export const CAP_HARD_MULT = 1.20;
export const CAP_TREE = {
  id: "ALL", label: "All", children: [
    { id: "P", label: "Pitchers", roster: 13, children: [
      { id: "SP",  label: "SP",         positions: ["SP"],       noMax: true },
      { id: "RP",  label: "RP",         positions: ["RP"],       roster: 8 },
    ] },
    { id: "H", label: "Hitters", roster: 13, children: [
      { id: "C",   label: "C",          positions: ["C"],        roster: 2 },
      { id: "INF", label: "INF", roster: 6, children: [
        { id: "MI",  label: "MI (SS/2B)", positions: ["SS", "2B"], noMax: true },
        { id: "1B",  label: "1B",         positions: ["1B"],       roster: 1 },
        { id: "3B",  label: "3B",         positions: ["3B"],       roster: 1 },
      ] },
      { id: "OF", label: "OF", roster: 5, children: [
        { id: "CF",  label: "CF",         positions: ["CF"],       noMax: true },
        { id: "cOF", label: "Corner OF",  positions: ["LF", "RF"], roster: 2 },
      ] },
    ] },
  ],
};

// ---- Derived views of CAP_TREE (built once at module load) ----
// CAP_TREE_WALK: depth-first node list with depth/isLeaf + softPct/hardPct (null
//   for no-max nodes) for the indented UI + defaultCaps.
// CAP_LEAVES: leaf nodes (have `positions`) — the per-position relief groups.
// POS_TO_LEAF: OOTP position string -> leaf id (DH folds into 1B).
// LEAF_CHAINS: leaf id -> [leaf id, ...ancestor ids] (excludes ALL root) — the
//   cap chain whose MAX penalty applies to a pick at that leaf.
export const CAP_TREE_WALK = [];
export const CAP_LEAVES = [];
export const POS_TO_LEAF = {};
export const LEAF_CHAINS = {};
(function buildCapTreeDerived() {
  const walk = (node, depth, ancestors) => {
    const isLeaf = !node.children;
    const capped = node.id !== "ALL" && !node.noMax && node.roster != null;
    const softPct = capped ? node.roster / ROSTER_SIZE : null;
    const hardPct = capped ? softPct * CAP_HARD_MULT : null;
    if (node.id !== "ALL") {
      CAP_TREE_WALK.push({ id: node.id, label: node.label, depth, isLeaf,
        roster: node.roster ?? null, softPct, hardPct,
        noMax: !capped, positions: node.positions ?? null });
    }
    const chain = node.id === "ALL" ? [] : [...ancestors, node.id];
    if (isLeaf) {
      CAP_LEAVES.push(node);
      (node.positions || []).forEach((pos) => { POS_TO_LEAF[pos] = node.id; });
      LEAF_CHAINS[node.id] = chain;
    } else {
      (node.children || []).forEach((c) => walk(c, node.id === "ALL" ? 0 : depth + 1, chain));
    }
  };
  walk(CAP_TREE, 0, []);
  POS_TO_LEAF.DH = POS_TO_LEAF.DH ?? "1B"; // DH-primary bats fold into 1B
})();

// Smart-rank tuning. All values are WAR-unit deltas — see applySmartRank.
// Defaults are first-pass estimates; expect to retune after a real draft.
export const SMART_RANK_TUNING = {
  // RP-role adjustment scale. RP WAR/FV is raw and compressed since the 2026-05-23 removal of the
  // "scaled negative WAR" ramp (a star reliever's FV ceiling is ~+0.6 vs a hitter's ~+6), so the
  // HIT/SP-calibrated deltas below would swamp a reliever's tiny value. We shrink the talent-relative
  // deltas (org need, prone, intangibles) for RP-role pitchers by this factor in applySmartRank.
  // Factor = the IP ratio IP_RP/IP_SP = 69.55/185.47 ≈ 0.375 — the structural cause of the SP-vs-RP
  // WAR-scale gap. Position caps, signability, and the coverage floor are NOT scaled (roster/budget-
  // structural; floor is C/MI/CF-only). Derivation + 2-league data:
  // Leftovers/rp-smart-rank-adjustments/RP_ADJUSTMENT_CALIBRATION.md.
  RP_ADJUST_SCALE: 0.375,

  // Org Positional Need — bonus = scale × maxNeed. As of the 2026-05-19
  // strength rebuild, calcOrgNeed returns need = max(0, -z): 0 at/above league
  // average (no more phantom bonus for average positions), 1.0 at z=-1, 2.0 at
  // z=-2, off the "now" (MLB-squad) z-scores by default. Scale 0.12 preserves the
  // prior "z=-1 weak position ≈ +0.12 WAR" magnitude (keeping org-need the
  // weakest smart-rank adjustment); z=-2 now gives +0.24 (the old +1-offset
  // formula artificially compressed the deep-weakness tail).
  ORG_NEED_BONUS_SCALE: 0.12,

  // Position Caps — RELIEF model with SOFT/HARD guardrails (2026-05-23).
  // A player's smart-rank value is the MAX over their eligible cap leaves of
  // (that leaf's FV − the leaf's CHAIN penalty): they keep the value of their
  // best eligible position whose cap chain isn't busted (an SS slides his value
  // to LF when MI is full). The pick COUNTS against his PRIMARY position. 1B/DH
  // are excluded from relief unless primary (near-universal eligibility).
  //
  // Two-tier per-player penalty (calibrated to the other smart-rank deltas:
  // intangibles ±0.45, Fragile +0.9, Wrecked +2.0, signability ≤3.0):
  //   below SOFT cap          → 0   (best-player-available; draft to roster share)
  //   in the soft→hard band   → CAP_SOFT_STEP per player over soft   (gentle ~0.5;
  //                              the "normal talent overage" zone, easily overridden)
  //   past the HARD cap       → CAP_HARD_STEP per player over hard    (harsh ~3.0;
  //                              hard-zone-ONLY — the band cost does NOT carry over)
  // Evaluated on (alreadyDrafted+1) so the cap-EXCEEDING pick is the one
  // penalized. Per-player (not cap-relative) so the big guardrails actually bind.
  // The penalty for a pick = MAX over its leaf→parent chain.
  CAP_SOFT_STEP: 0.5,
  CAP_HARD_STEP: 3.0,

  // Signability — penalty grows with demand share of *remaining* budget past
  // a no-penalty threshold. Using remaining (not total) means the formula
  // naturally captures budget tightness: as you spend down, the same demand
  // becomes a larger share, scaling the penalty up without a separate
  // tightness multiplier. Top picks aren't penalized because at fresh budget
  // even a $13M demand is well under the threshold; late picks with little
  // budget left bite hard because the share explodes.
  // Phase-2 tuning (2026-05-19): calibrated against BLM league draft spending
  // (avg $16.7M, p90 $28.8M) and demand distribution ($13M max). Threshold
  // 0.5 of remaining accommodates top-pick spending; demands exceeding
  // remaining hit the SIG_MAX_WAR cap.
  //
  // Sign category (Very Easy / Easy / Normal / Hard / Extremely Hard)
  // scales the player's effective demand — easier signs require less than
  // the listed amount to actually sign, harder signs need the full demand
  // (or more). OOTP's stated demand is treated as the *ceiling*; the
  // fraction below estimates the actual cost. The discounted demand then
  // feeds the share-of-remaining-budget formula.
  // Impossible is handled separately — fixed SIG_IMPOSSIBLE_WAR penalty
  // regardless of demand (these players will not sign for any realistic
  // budget amount).
  SIG_THRESHOLD: 0.5,
  SIG_BASE_WAR: 4.0,
  SIG_MAX_WAR: 3.0,
  SIG_IMPOSSIBLE_WAR: 3.0,
  // Impossible players have no parseable demand (OOTP emits "Impossible", the
  // pipeline stores demSort as NaN). For budget tracking we estimate their
  // signing cost above the realistic pool max — the user notes it typically
  // takes north of $15M and can exceed $20M to sign one.
  SIG_IMPOSSIBLE_DEMAND: 20_000_000,
  SIG_DEMAND_FRACTION: {
    "Very Easy":      0.85,
    "Easy":           0.90,
    "Normal":         0.93,
    "Hard":           0.97,
    "Extremely Hard": 1.00,
    // "Impossible" handled separately via SIG_IMPOSSIBLE_WAR / SIG_IMPOSSIBLE_DEMAND
  },

  // Injury Proneness — direct WAR delta per OOTP prone string. Negative = bonus.
  // Phase-2 calibration (2026-05-19): grounded in BLM injury_history data
  // (n=10,198 players). Days-lost-per-career-year by tier: Iron Man 0.3,
  // Durable 0.6, Normal 3.8, Fragile 27.8, Wrecked 39.7. Translated to WAR
  // for a typical 3-WAR player with information-value adjustments:
  // - Durable's bonus is bigger than the face injury rate suggests because
  //   it rules out hidden Fragile/Wrecked underneath (young players' true
  //   prone is partially obscured — see project_prone_reveal.md).
  // - Iron Man / Wrecked rarely appear on draft-age players; weights tuned
  //   for the rare case where they do (strong reveal in either direction).
  PRONE_PENALTY_WAR: {
    "Iron Man": -0.5,
    "Durable":  -0.3,
    "Normal":    0,
    "Fragile":   0.9,
    "Wrecked":   2.0,
  },

  // Intangibles — signed WAR delta scaled by the player's 20–80 grade
  // deviation from 50 (one std-dev = ±10 grade points).
  // Phase-2 calibration (2026-05-19): 0.15 after reviewing BLM + SSB draft
  // class data (n=7 classes). Designed for within-tier reorder at top picks,
  // with intentionally larger relative impact in late rounds where FV gaps
  // shrink. Grade is bounded to 20-80 by the helpers.js normalizer, so the
  // bonus is naturally capped at 3.0 × 0.15 = 0.45 WAR — no separate clamp
  // needed.
  INT_BONUS_WAR: 0.15,

  // Coverage Floor — the MIN-puller that complements the cap MAX-limiter. A small
  // per-leaf WAR bonus (≤ FLOOR_MAX_BONUS) is added to candidates whose PRIMARY leaf
  // is still under its minimum, so the board nudges you to secure ≥1 at scarce
  // premium spots (C / MI / CF) without distorting the top of the draft. Driven by a
  // DECOUPLED two-cushion urgency, validated in Leftovers/draft-cap-sim/
  // (coverage_floor_sweep.md): the SCARCITY trigger fires as the WAR-P>0 supply at the
  // leaf thins toward FLOOR_CUSHION_S; the PICKS net fires as your remaining picks
  // fall toward FLOOR_PICKS_START. The ramp reaches the full bonus at HALF the fire
  // point, and the bonus stops once the minimum is met. Tuning locked after the
  // K=10,000 sweep: lifts MI/CF coverage (whiff ~37→24% / ~27→17% at 20 rounds) while leaving
  // the first four picks essentially untouched (≤0.3% flipped). FLOOR_MINS is the
  // default per-position target; the Draft Board persists user overrides.
  FLOOR_MINS: { C: 1, MI: 1, CF: 1 },
  FLOOR_CUSHION_S: 12,
  FLOOR_PICKS_START: 10,
  FLOOR_MAX_BONUS: 0.5,
  FLOOR_POWER: 0.5,
};

// `requires` names a key in dashMeta.csvPresence that must be true for the
// page to appear (e.g. "hasFreeAgents" hides Free Agent Finder when no
// freeagents.csv was provided). Pages without `requires` are always visible.
export const PAGES = [
  { id: "org", label: "My Organization", icon: "🏠" },
  { id: "players", label: "All Players", icon: "📊" },
  { id: "fa", label: "Free Agent Finder", icon: "🔍", requires: "hasFreeAgents" },
  { id: "draft", label: "Draft Board", icon: "📋", requires: "hasDraft" },
  { id: "iafa", label: "IAFA Board", icon: "🌎", requires: "hasIAFA" },
  { id: "dev", label: "Dev Analysis", icon: "📈" },
  { id: "scout", label: "Scout View", icon: "🔭" },
  { id: "compare", label: "Player Compare", icon: "⚖️" },
  { id: "r5", label: "Rule 5 Board", icon: "📝" },
  { id: "prospects", label: "Prospects", icon: "⭐" },
  { id: "roster", label: "Roster Planner", icon: "📆" },
];

export const FV_TIERS = [
  { id: "80", label: "80", defaultBat: 162, defaultPit: 120 },
  { id: "70", label: "70", defaultBat: 112, defaultPit: 85 },
  { id: "65", label: "65", defaultBat: 62, defaultPit: 64 },
  { id: "60", label: "60", defaultBat: 55, defaultPit: 60 },
  { id: "55", label: "55", defaultBat: 46, defaultPit: 34 },
  { id: "50", label: "50", defaultBat: 28, defaultPit: 21 },
  { id: "45+", label: "45+", defaultBat: 8, defaultPit: 6 },
  { id: "45", label: "45", defaultBat: 6, defaultPit: 4 },
  { id: "40+", label: "40+", defaultBat: 4, defaultPit: 3 },
  { id: "40", label: "40", defaultBat: 2, defaultPit: 1 },
  { id: "35+", label: "35+", defaultBat: 1, defaultPit: 0.5 },
];

export const FG_TIER_STATS = {
  "80":  { avg: 0.214,  std: 0.426 },
  "70":  { avg: 0.571,  std: 0.629 },
  "65":  { avg: 1.571,  std: 1.351 },
  "60":  { avg: 12.071, std: 4.006 },
  "55":  { avg: 21.214, std: 4.130 },
  "50":  { avg: 76.714, std: 9.202 },
  "45+": { avg: 39.714, std: 4.909 },
  "45":  { avg: 126.357, std: 10.356 },
  "40+": { avg: 171.857, std: 25.798 },
  "40":  { avg: 395.643, std: 27.873 },
  "35+": { avg: 372.643, std: 51.713 },
};

export const PROSPECT_SUB_TABS = [
  { id: "board", label: "The Board" },
  { id: "farm", label: "Farm Rankings" },
];

export const PROSPECT_SETTINGS_KEY = "prospect_board_settings";

// Thresholds for the SP-vs-RP "best role" decision in calcBestPos.
// Calibrated for WAR (post-v0.2.0). To get the pre-WAR-shift WAA-equivalent:
//   SP_REPLACEMENT_WAR ≈ WAA_threshold + 1.5  (SP gets +1.5 WAR full-time)
//   RP_ADVANTAGE_THRESHOLD_WAR ≈ WAA_threshold − 1.0  (RP credit − SP credit)
export const SP_REPLACEMENT_WAP = -0.5;
export const RP_ADVANTAGE_THRESHOLD = 1.0;

export const IP_SP = 185.47;             // Avg SP innings/season (model calibration)
export const IP_RP = 69.55;              // Avg RP innings/season (model calibration)
export const RP_SCALE_THRESHOLD = -0.50; // RP WAA at 10th pct of MLB relievers — full IP-ratio scaling below this
export const DEF_TIERS = [
  ["C", "SS", "CF"],
  ["2B", "3B", "RF"],
  ["LF", "1B"],
];
export const TIER_RUNSP_MIN = -15;
export const TIER_DROP_ADVANTAGE = 15;

export const PLAYERS_HIT_COLS = [{ key: "Name", label: "Name", w: 170 }, { key: "_age", label: "Age", w: 45 }, { key: "POS", label: "POS", w: 45 }, { key: "_bestPos", label: "Best", w: 48 }, { key: "ORG", label: "Team", w: 130 }, { key: "Lev", label: "Lvl", w: 45 }, { key: "_fv", label: "FV", w: 60 }, { key: "Max WAR wtd", label: "WAR", w: 65 }, { key: "MAX WAR P", label: "WAR P", w: 65 }, { key: "_devPct", label: "Dev%", w: 48 }, { key: "Prone", label: "Prone", w: 65 }, { key: "_intangibles", label: "INTS", w: 48 }, { key: "Price", label: "Salary", w: 85 }];
export const PLAYERS_PIT_COLS = [{ key: "Name", label: "Name", w: 170 }, { key: "_age", label: "Age", w: 45 }, { key: "POS", label: "POS", w: 45 }, { key: "_bestPos", label: "Best", w: 48 }, { key: "ORG", label: "Team", w: 130 }, { key: "Lev", label: "Lvl", w: 45 }, { key: "_fv", label: "FV", w: 60 }, { key: "WAR wtd", label: "SP WAR", w: 68 }, { key: "WAR wtd RP", label: "RP WAR", w: 68 }, { key: "WARP", label: "SP WARP", w: 68 }, { key: "WARP RP", label: "RP WARP", w: 68 }, { key: "_devPct", label: "Dev%", w: 48 }, { key: "STM", label: "STM", w: 42 }, { key: "Starter", label: "SP?", w: 42 }, { key: "Prone", label: "Prone", w: 65 }, { key: "_intangibles", label: "INTS", w: 48 }, { key: "Price", label: "Salary", w: 85 }];
export const PLAYERS_MIXED_COLS = [{ key: "Name", label: "Name", w: 170 }, { key: "_age", label: "Age", w: 45 }, { key: "POS", label: "POS", w: 45 }, { key: "_bestPos", label: "Best", w: 48 }, { key: "ORG", label: "Team", w: 130 }, { key: "Lev", label: "Lvl", w: 45 }, { key: "_fv", label: "FV", w: 60 }, { key: "_devPct", label: "Dev%", w: 48 }, { key: "Prone", label: "Prone", w: 65 }, { key: "Price", label: "Salary", w: 85 }];
