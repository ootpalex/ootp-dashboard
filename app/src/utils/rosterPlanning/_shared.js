// Cross-cutting helpers used by multiple rosterPlanning sub-modules.
import { parseCSVBoolean } from "../helpers.js";

// OOTP service time encoding: 1 full season = 172 days.
// MLD (meta.mld) = total cumulative MLB service days.
//   mldYears = floor(MLD / 172), mldDays = MLD % 172.
// SECY/SECD = secondary (minor league) roster time, NOT MLB service.
export const DAYS_PER_SEASON = 172;

/** Extract full years and remaining days from MLD (total MLB service days). */
export function parseMLD(mld) {
  if (mld == null || isNaN(mld)) return { years: 0, days: 0 };
  const years = Math.floor(mld / DAYS_PER_SEASON);
  const days = mld - years * DAYS_PER_SEASON;
  return { years, days };
}

/** Pitcher is "SP-role" if the starter flag is set, regardless of meta.pos. */
export function isSpEligible(ep) {
  return (ep.starter ?? parseCSVBoolean(ep.Starter)) ||
    (ep.starterP ?? parseCSVBoolean(ep["Starter P"]));
}
