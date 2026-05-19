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

// Cap group defaults — Phase-2 calibration (2026-05-19), validated via
// 42-draft simulation across 5 leagues (BLM-ATL/COL/MIA/NYM + SSB 3 classes).
// Percentages sum to 100%. Each cap is an independent ceiling — a player's
// primary position counts against ONE cap (no double-counting). The cap
// penalty system uses player eligibility to find the best "landing spot."
// Removed DH (effectively never drafted; 1B/DH-eligible prospects fall under
// CI). Split former CI group into separate 3B/1B caps (asymmetric value:
// 3B premium, 1B abundant).
export const CAP_GROUPS = [
  { id: "SP",  label: "SP",         positions: ["SP"],       pct: 0.30 },
  { id: "RP",  label: "RP",         positions: ["RP"],       pct: 0.18 },
  { id: "C",   label: "C",          positions: ["C"],        pct: 0.10 },
  { id: "MI",  label: "MI (SS/2B)", positions: ["SS", "2B"], pct: 0.12 },
  { id: "3B",  label: "3B",         positions: ["3B"],       pct: 0.06 },
  { id: "1B",  label: "1B",         positions: ["1B"],       pct: 0.04 },
  { id: "CF",  label: "CF",         positions: ["CF"],       pct: 0.12 },
  { id: "COF", label: "Corner OF",  positions: ["LF", "RF"], pct: 0.09 },
];

// Display order for the Draft Board's Position Caps chip strip — defensive
// spectrum first (hardest position), corners next, pitchers at the end.
export const CAP_GROUP_DISPLAY_ORDER = ["C", "CF", "MI", "3B", "COF", "1B", "SP", "RP"];

// Smart-rank tuning. All values are WAR-unit deltas — see applySmartRank.
// Defaults are first-pass estimates; expect to retune after a real draft.
export const SMART_RANK_TUNING = {
  // Org Positional Need — bonus = scale × maxNeed (where maxNeed comes from
  // calcOrgNeed: 0.3 at z=0, 0.6 at z=-1, 0.9 at z=-2).
  // Phase-2 calibration (2026-05-19): 0.20 after z-score distribution
  // analysis across 5 leagues × 148 team-positions (n=1480). Distribution is
  // ~N(0,1); only ~12% of team-positions are at z<-1 ("notably weak"). 0.20
  // keeps the bonus below intangibles at every matched rarity, satisfying
  // the design intent of "weakest of the smart-rank adjustments." z=-1
  // weak position gives +0.12 WAR (~11 spots in R5-7); z=-2 gives +0.18 WAR.
  ORG_NEED_BONUS_SCALE: 0.20,

  // Position Caps — additive penalty driven by the player's best landing spot
  // (min fill across their eligible cap groups). Gentle slope between START
  // and 1.0; steep slope past 1.0.
  // Phase-2 tuning (2026-05-19), revised after 42-draft simulation across
  // 5 leagues × 7 draft classes: middle-ground curve — start penalizing at
  // 50% fill (gentle ramp), 0.30 WAR at exactly cap, 2.5 WAR per unit over.
  // Yields 53% pitcher split (close to 50/50 target) with moderate but
  // permissive enforcement. Allows talent-driven lean: ~3 WAR gap lets you
  // go 2-3 over a cap; 5+ WAR gap supports the full 80/20 lopsided scenario.
  CAP_START: 0.5,
  CAP_GENTLE_WAR: 0.30,
  CAP_STEEP_WAR: 2.5,
  CAP_MAX_WAR: 4.0,

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
  SIG_DEMAND_FRACTION: {
    "Very Easy":      0.85,
    "Easy":           0.90,
    "Normal":         0.93,
    "Hard":           0.97,
    "Extremely Hard": 1.00,
    // "Impossible" handled separately via SIG_IMPOSSIBLE_WAR
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
