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

export const G5_DEFAULTS = { maxCurrentAge: 27, riskMin: 0.50, riskMax: 0.95, riskExp: 30, bandwidth: 0.5, gapMax: 0.85, gapExp: 2, riskMode: 'logit', logitK: 0.6 };
export const G5_POWER_DEFAULTS = { riskMin: 0.82, riskMax: 0.90, riskExp: 30, gapMax: 0.95, gapExp: 6 };

export const CAP_GROUPS = [
  { id: "SP", label: "SP", positions: ["SP"], pct: 0.30 },
  { id: "RP", label: "RP", positions: ["RP"], pct: 0.10 },
  { id: "C", label: "C", positions: ["C"], pct: 0.10 },
  { id: "MI", label: "MI (SS/2B)", positions: ["SS", "2B"], pct: 0.12 },
  { id: "UM", label: "CF", positions: ["CF"], pct: 0.08 },
  { id: "CI", label: "CI (3B/1B)", positions: ["3B", "1B"], pct: 0.12 },
  { id: "COF", label: "Corner OF", positions: ["LF", "RF"], pct: 0.10 },
  { id: "DH", label: "DH", positions: ["DH"], pct: 0.01 },
];

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

export const SP_REPLACEMENT_WAP = -2.0;
export const RP_ADVANTAGE_THRESHOLD = 2.0;

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

export const PLAYERS_HIT_COLS = [{ key: "Name", label: "Name", w: 170 }, { key: "_age", label: "Age", w: 45 }, { key: "POS", label: "POS", w: 45 }, { key: "_bestPos", label: "Best", w: 48 }, { key: "ORG", label: "Team", w: 130 }, { key: "Lev", label: "Lvl", w: 45 }, { key: "_fv", label: "FV", w: 60 }, { key: "Max WAA wtd", label: "WAA", w: 65 }, { key: "MAX WAA P", label: "WAA P", w: 65 }, { key: "_devPct", label: "Dev%", w: 48 }, { key: "Prone", label: "Prone", w: 65 }, { key: "_intangibles", label: "INTS", w: 48 }, { key: "Price", label: "Salary", w: 85 }];
export const PLAYERS_PIT_COLS = [{ key: "Name", label: "Name", w: 170 }, { key: "_age", label: "Age", w: 45 }, { key: "POS", label: "POS", w: 45 }, { key: "_bestPos", label: "Best", w: 48 }, { key: "ORG", label: "Team", w: 130 }, { key: "Lev", label: "Lvl", w: 45 }, { key: "_fv", label: "FV", w: 60 }, { key: "WAA wtd", label: "SP WAA", w: 68 }, { key: "WAA wtd RP", label: "RP WAA", w: 68 }, { key: "WAP", label: "SP WAP", w: 68 }, { key: "WAP RP", label: "RP WAP", w: 68 }, { key: "_devPct", label: "Dev%", w: 48 }, { key: "STM", label: "STM", w: 42 }, { key: "Starter", label: "SP?", w: 42 }, { key: "Prone", label: "Prone", w: 65 }, { key: "_intangibles", label: "INTS", w: 48 }, { key: "Price", label: "Salary", w: 85 }];
export const PLAYERS_MIXED_COLS = [{ key: "Name", label: "Name", w: 170 }, { key: "_age", label: "Age", w: 45 }, { key: "POS", label: "POS", w: 45 }, { key: "_bestPos", label: "Best", w: 48 }, { key: "ORG", label: "Team", w: 130 }, { key: "Lev", label: "Lvl", w: 45 }, { key: "_fv", label: "FV", w: 60 }, { key: "_devPct", label: "Dev%", w: 48 }, { key: "Prone", label: "Prone", w: 65 }, { key: "Price", label: "Salary", w: 85 }];
