// ============================================================================
// SETTINGS — Load/save league and prospect settings (per-league scoped)
// ============================================================================
import { LEAGUE_SETTINGS_KEY, DEFAULT_LEAGUE_SETTINGS, PROSPECT_SETTINGS_KEY } from "./constants.js";
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
// Returns null when the league has no StatsPlus URL configured — there is
// NO cross-league fallback (fetching another league's StatsPlus data as this
// league's would silently corrupt salary/contract features).
function normalizeStatsBase(settings) {
  const raw = (settings?.statsplusUrl || "").trim();
  if (!raw) return null;
  const url = raw.replace(/\/$/, "");
  return url.endsWith("/api") ? url.slice(0, -4) : url;
}

// In dev, rewrite a StatsPlus URL into a /sp/<host>/<path> proxy URL so the
// Vite dev server can forward to the correct host per league (see vite.config.js
// for the dynamic proxy). In prod, return the absolute URL unchanged.
// An unparseable URL returns null (treated as unconfigured) rather than
// falling back to some other league's host.
function devProxy(absoluteUrl) {
  if (!import.meta.env.DEV) return absoluteUrl;
  try {
    const u = new URL(absoluteUrl);
    const path = u.pathname.replace(/\/$/, "");
    return `/sp/${u.host}${path}`;
  } catch {
    return null;
  }
}

// Returns the API base URL (appends /api), or null when no StatsPlus URL is
// configured. All callers must handle null (skip the fetch / show a
// "configure your StatsPlus URL" state).
export function getStatsplusBase(settings) {
  const base = normalizeStatsBase(settings);
  return base == null ? null : devProxy(base + "/api");
}

// Returns the page/reports base URL (no /api), or null when unconfigured.
// Used for HTML report page fetches.
export function getStatsplusPageBase(settings) {
  const base = normalizeStatsBase(settings);
  return base == null ? null : devProxy(base);
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
