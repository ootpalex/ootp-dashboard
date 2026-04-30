import { createContext, useContext, useEffect, useState } from "react";

// Persists a value to localStorage. Defaults treat values as strings — pass
// { serialize, deserialize } to round-trip non-string types (e.g. parseFloat
// for numbers). Reads happen once, lazily, on mount.
export function useLocalStorage(key, defaultValue, options = {}) {
  const { serialize = String, deserialize = (s) => s } = options;
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? defaultValue : deserialize(raw);
    } catch {
      return defaultValue;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, serialize(value)); } catch {}
  }, [key, value, serialize]);
  return [value, setValue];
}

// Build a namespaced storage key. When `slug` is empty/null the unscoped
// base key is returned so single-league deployments and legacy localStorage
// values stay readable.
export function keyFor(slug, baseKey) {
  return slug ? `${baseKey}::${slug}` : baseKey;
}

// Source of truth for the active league slug. Helpers that read/write
// localStorage outside the React tree (e.g. utility modules, save/load
// functions) call this instead of threading the slug through every caller.
const CURRENT_LEAGUE_KEY = "ssb_current_league";
export function getCurrentSlug() {
  try {
    const raw = localStorage.getItem(CURRENT_LEAGUE_KEY);
    return raw ? raw.replace(/^"|"$/g, "") : null;
  } catch {
    return null;
  }
}

// Read a value from localStorage at the per-league scope, falling back to the
// legacy unscoped key when the scope is empty (one-time hoisting). Used by
// non-hook helpers like loadLeagueSettings / loadMoves / loadProspectSettings.
export function readScoped(baseKey) {
  const scopedKey = keyFor(getCurrentSlug(), baseKey);
  try {
    const scoped = localStorage.getItem(scopedKey);
    if (scoped != null) return scoped;
    if (scopedKey !== baseKey) return localStorage.getItem(baseKey);
    return null;
  } catch {
    return null;
  }
}

// Write a value to localStorage at the per-league scope.
export function writeScoped(baseKey, value) {
  const scopedKey = keyFor(getCurrentSlug(), baseKey);
  try {
    localStorage.setItem(scopedKey, value);
  } catch {}
}

// React context that provides the active league slug to scoped storage hooks.
// Default null = unscoped (legacy single-league mode).
export const LeagueSlugContext = createContext(null);

// Per-league localStorage hook. Reads/writes under `${baseKey}::${slug}` when
// a league is active. On first mount, if the scoped slot is empty but a
// legacy unscoped value exists, the legacy value is hoisted into the scope so
// existing user state isn't lost when the project transitions to multi-league.
export function useScopedLocalStorage(baseKey, defaultValue, options = {}) {
  const slug = useContext(LeagueSlugContext);
  const { serialize = String, deserialize = (s) => s } = options;
  const scopedKey = keyFor(slug, baseKey);

  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(scopedKey);
      if (raw != null) return deserialize(raw);
      // One-time fallback: hoist legacy unscoped value into the scope.
      if (slug && scopedKey !== baseKey) {
        const legacy = localStorage.getItem(baseKey);
        if (legacy != null) return deserialize(legacy);
      }
      return defaultValue;
    } catch {
      return defaultValue;
    }
  });

  // Writes always go to the scoped key. The legacy unscoped key is left in
  // place (deliberately not cleared) so other leagues can still hoist from it.
  useEffect(() => {
    try { localStorage.setItem(scopedKey, serialize(value)); } catch {}
  }, [scopedKey, value, serialize]);

  return [value, setValue];
}
