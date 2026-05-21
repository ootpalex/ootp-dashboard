// ============================================================================
// DECLINE — standard MLB aging curve for projecting CURRENT value forward.
// ============================================================================
// Used to flag "aging cores" / future needs in the positional-strength engine:
// FV (calcFutureValue) only ever credits upside for under-27 players and equals
// current WAR for everyone 27+, so it can never project a decline. This module
// supplies that missing piece — a multiplicative WAR-retention curve that ages
// a player's current value forward.
//
// The shape approximates published delta-method aging research (peak ~26-27,
// gentle decline through the early 30s, steeper past 33). We use a standard
// external curve rather than this league's own age->WAR distribution because a
// single-season snapshot is corrupted by survivorship bias (the old players
// still in the league are the survivors, flattening the apparent decline). When
// a multi-season export exists, replace these tables with a league-specific
// delta-method curve. NOT used for the "future" strength score (that uses FV) —
// only for the decline/aging-core projection.
import { AGING } from "./constants.js";

const PEAK = { hitter: 27, pitcher: 26 };

// Retention for the single year ENTERING `age` (factor vs. the prior year).
// Pitchers decline a bit earlier and steeper than hitters.
function annualRetention(age, type) {
  const peak = PEAK[type] ?? PEAK.hitter;
  if (age <= peak) return 1.0;
  const d = age - peak;
  if (type === "pitcher") {
    if (d <= 3) return 0.95;   // ~27-29
    if (d <= 6) return 0.92;   // ~30-32
    return 0.89;               // 33+
  }
  if (d <= 3) return 0.97;     // ~28-30
  if (d <= 6) return 0.94;     // ~31-33
  return 0.90;                 // 34+
}

// Fraction of peak value retained at a (possibly fractional) age. 1.0 at/below
// peak, decreasing after. Integrates the annual-retention steps, handling a
// fractional final year so smooth ages interpolate.
export function retentionAt(age, type = "hitter") {
  const peak = PEAK[type] ?? PEAK.hitter;
  if (age == null || age <= peak) return 1.0;
  let f = 1.0;
  let a = peak;
  while (a < age) {
    const step = Math.min(1, age - a);
    f *= Math.pow(annualRetention(a + 1, type), step);
    a += 1;
  }
  return f;
}

// Project a current WAR forward `years`, applying decline only (no growth
// credit — growth is FV's job). For players who are still at/below peak after
// the horizon the factor is 1.0, so young contributors are unaffected.
export function projectDecline(war, age, type = "hitter", years = AGING.horizon) {
  if (war == null || age == null) return war;
  const ratio = retentionAt(age + years, type) / retentionAt(age, type);
  return war * ratio;
}
