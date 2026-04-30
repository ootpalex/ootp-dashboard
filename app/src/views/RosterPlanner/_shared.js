// Constants and helpers shared across RosterPlanner sub-panels.
import { parseCSVBoolean } from "../../utils/helpers.js";
import { readScoped, writeScoped } from "../../hooks/useLocalStorage.js";

export const ROSTER_PLAN_KEY = "ssb_roster_plan";
export const ROSTER_PLAN_ORDER_KEY = "ssb_roster_plan_order";
export const R5_THRESHOLD_KEY = "ssb_roster_r5_threshold";
export const YEAR_COUNT = 4;

export const BUCKET_CONFIG = {
  active:    { label: "Active 26-Man",          color: "#22c55e", icon: "+" },
  fortyMan:  { label: "40-Man (Inactive)",      color: "#60a5fa", icon: "=" },
  ilShort:   { label: "Short-Term IL (15-day)", color: "#fbbf24", icon: "+" },
  ilLong:    { label: "Long-Term IL (60-day)",  color: "#f97316", icon: "+" },
  r5Risk:    { label: "Must Protect (R5 Risk)", color: "#f97316", icon: "!" },
  prospects: { label: "Prospect Pipeline",      color: "#a78bfa", icon: "*" },
  departing: { label: "Departing (FA/Expiring)", color: "#ef4444", icon: "-" },
};

export const SEVERITY_STYLES = {
  error:   { bg: "rgba(239,68,68,0.12)", border: "#dc2626", color: "#fca5a5" },
  warning: { bg: "rgba(250,204,21,0.10)", border: "#ca8a04", color: "#fde047" },
  info:    { bg: "rgba(96,165,250,0.10)", border: "#2563eb", color: "#93c5fd" },
};

// Pitcher is "SP-role" if the starter flag is set, regardless of meta.pos.
// Avoids the getSpWaa eligibility gate returning null for meta.pos="SP"
// pitchers that are actually RP-only.
export const isSpRole = (p) =>
  (p.starter ?? parseCSVBoolean(p.Starter)) ||
  (p.starterP ?? parseCSVBoolean(p["Starter P"]));

export function loadMoves() {
  try { return JSON.parse(readScoped(ROSTER_PLAN_KEY)) || {}; } catch { return {}; }
}
export function saveMoves(moves) {
  writeScoped(ROSTER_PLAN_KEY, JSON.stringify(moves));
}
export function loadMoveOrder() {
  try { return JSON.parse(readScoped(ROSTER_PLAN_ORDER_KEY)) || []; } catch { return []; }
}
export function saveMoveOrder(order) {
  writeScoped(ROSTER_PLAN_ORDER_KEY, JSON.stringify(order));
}
