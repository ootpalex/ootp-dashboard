// Constants and helpers shared across RosterPlanner sub-panels.
import { parseCSVBoolean } from "../../utils/helpers.js";
import { readScoped, writeScoped } from "../../hooks/useLocalStorage.js";
import { TOKENS as T, S, mixOklab } from "../../theme.js";

export const ROSTER_PLAN_KEY = "ssb_roster_plan";
export const ROSTER_PLAN_ORDER_KEY = "ssb_roster_plan_order";
export const R5_THRESHOLD_KEY = "ssb_roster_r5_threshold";
export const YEAR_COUNT = 4;

// Bucket colours are the semantic tokens (Night Scorecard): the bucket colour
// draws the 3px left rule on each panel's header strip.
export const BUCKET_CONFIG = {
  active:    { label: "Active 26-Man",          color: T.good,          icon: "+" },
  fortyMan:  { label: "40-Man (Inactive)",      color: T.accent,        icon: "=" },
  ilShort:   { label: "Short-Term IL (15-day)", color: T.warn,          icon: "+" },
  ilLong:    { label: "Long-Term IL (60-day)",  color: T.warn,          icon: "+" },
  r5Risk:    { label: "Must Protect (R5 Risk)", color: T.warn,          icon: "!" },
  prospects: { label: "Prospect Pipeline",      color: T.CHART.series5, icon: "*" },
  departing: { label: "Departing (FA/Expiring)", color: T.bad,          icon: "-" },
};

// Crunch-warning boxes: token fills, r3.
export const SEVERITY_STYLES = {
  error:   { bg: T.badBg,     border: T.bad,    color: T.badSoft },
  warning: { bg: T.warnBg,    border: T.warn,   color: T.warn },
  info:    { bg: T.accentBg2, border: T.accent, color: T.accent },
};

// The violet family (Super-Two, MiLB-FA, "potential", "Needs reps") = CHART.series5,
// with 12% / 15% fills over panel (D.5), derived in OKLab like the theme's own mixes.
export const POTENTIAL_BG = mixOklab(T.CHART.series5, 0.12, T.panel);      // row highlight
export const POTENTIAL_CHIP_BG = mixOklab(T.CHART.series5, 0.15, T.panel); // chips / tags

// Small tag chip (r3, Archivo Narrow 700) — spread a { bg, color } after it.
export const TAG_CHIP = {
  display: "inline-block", fontFamily: T.fonts.narrow, fontWeight: 700, fontSize: 11,
  lineHeight: "16px", padding: "0 5px", borderRadius: T.radius, whiteSpace: "nowrap",
};

// Queue action buttons: PillBtn-style secondary (panel fill) with the semantic
// colour on text + border. tone: "good" | "bad" | "neutral" | any token colour.
export function actionBtn(tone, extra) {
  const c = tone === "good" ? T.good : tone === "bad" ? T.bad : tone === "neutral" ? T.text2 : tone;
  return { ...S.pillBtn, fontSize: 11, padding: "2px 9px", borderColor: tone === "neutral" ? T.line2 : c, color: c, ...extra };
}

// Pitcher is "SP-role" if the starter flag is set, regardless of meta.pos.
// Avoids the getSpWar eligibility gate returning null for meta.pos="SP"
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
