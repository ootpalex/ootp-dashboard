// ============================================================================
// SETTINGS — Load/save league and prospect settings (per-league scoped)
// ============================================================================
import { LEAGUE_SETTINGS_KEY, DEFAULT_LEAGUE_SETTINGS, STATSPLUS_PROXY, PROSPECT_SETTINGS_KEY } from "./constants.js";
import { readScoped, writeScoped } from "../hooks/useLocalStorage.js";

export function loadLeagueSettings() {
  try {
    const saved = JSON.parse(readScoped(LEAGUE_SETTINGS_KEY));
    if (!saved) return { ...DEFAULT_LEAGUE_SETTINGS };
    return { ...DEFAULT_LEAGUE_SETTINGS, ...saved };
  } catch { return { ...DEFAULT_LEAGUE_SETTINGS }; }
}

export function saveLeagueSettings(settings) {
  writeScoped(LEAGUE_SETTINGS_KEY, JSON.stringify(settings));
}

export function detectExcludedTeams(rawRows) {
  const counts = {};
  rawRows.forEach((r) => {
    const org = (r.meta?.org ?? r.ORG ?? "").trim();
    if (!org || org === "0" || org === "-") return;
    counts[org] = (counts[org] || 0) + 1;
  });
  const vals = Object.values(counts);
  if (vals.length < 2) return [];
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const threshold = mean * 0.25;
  return Object.entries(counts).filter(([, c]) => c < threshold).map(([org]) => org);
}

// Normalize stored URL to a base (no trailing /api, no trailing slash).
// Handles both old format (ending in /api) and new format (base URL).
function normalizeStatsBase(settings) {
  const url = (settings?.statsplusUrl || DEFAULT_LEAGUE_SETTINGS.statsplusUrl).replace(/\/$/, "");
  return url.endsWith("/api") ? url.slice(0, -4) : url;
}

// Returns the API base URL (appends /api). All existing callers use this.
export function getStatsplusBase(settings) {
  const base = normalizeStatsBase(settings);
  if (import.meta.env.DEV) {
    try { return STATSPLUS_PROXY + new URL(base + "/api").pathname; } catch { return STATSPLUS_PROXY + "/ssb/api"; }
  }
  return base + "/api";
}

// Returns the page/reports base URL (no /api). Used for HTML report page fetches.
export function getStatsplusPageBase(settings) {
  const base = normalizeStatsBase(settings);
  if (import.meta.env.DEV) {
    try { return STATSPLUS_PROXY + new URL(base + "/").pathname.replace(/\/$/, ""); } catch { return STATSPLUS_PROXY + "/ssb"; }
  }
  return base;
}

export function loadProspectSettings() {
  try {
    const saved = JSON.parse(readScoped(PROSPECT_SETTINGS_KEY));
    if (!saved) return null;
    return saved;
  } catch { return null; }
}

export function saveProspectSettings(settings) {
  writeScoped(PROSPECT_SETTINGS_KEY, JSON.stringify(settings));
}
