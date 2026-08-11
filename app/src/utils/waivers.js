// ============================================================================
// WAIVER WIRE — source resolution
// ============================================================================
// Two independent waiver signals reach the frontend, and they routinely
// disagree because they are snapshots of different moments:
//
//   meta.is_on_waivers  — StatsPlus /players, fetched live at pipeline run.
//                         The only source carrying meta.days_on_waivers_left
//                         (the claim clock).
//   meta.waiv           — the WAIV column of org.csv, i.e. as of whenever the
//                         user last exported. Waivers clear in ~3 in-game days,
//                         so this field goes stale faster than anything else
//                         the pipeline ships. In a mid-2043 SSB build the two
//                         sources shared *zero* players (13 live vs 6 export).
//
// Policy: StatsPlus is authoritative. CSV-only rows are still surfaced, but in
// a separate section labelled as a possibly-stale export snapshot rather than
// mixed into the live board. When a league has no StatsPlus URL configured the
// live keys are absent entirely and the CSV column is all we have — the view
// relabels itself accordingly (see `hasLiveWaiverSource`).
import { parseCSVBoolean } from "./helpers.js";

export const WAIVER_LIVE = "live";
export const WAIVER_EXPORT = "export";

const FORTY_MAN_LIMIT = 40;

// StatsPlus rows carry `designated_for_assignment` for a large tail of
// org-less / retired players, so a real org is required before any waiver flag
// is believed.
const hasRealOrg = (p) => {
  const org = (p.meta?.org ?? p.ORG ?? "").trim();
  return org !== "" && org !== "-" && org !== "0";
};

/**
 * True when the StatsPlus /players merge ran for this league. `statsplus.py`
 * only writes keys whose CSV value was non-empty, so the mere presence of the
 * key (even `false`) means the live source is available.
 */
export function hasLiveWaiverSource(data) {
  const seen = (p) => p.meta?.is_on_waivers !== undefined;
  return data.hitters.some(seen) || data.pitchers.some(seen);
}

/** WAIVER_LIVE, WAIVER_EXPORT, or null if the player isn't on waivers. */
export function waiverSource(p, liveAvailable) {
  if (!hasRealOrg(p)) return null;
  if (liveAvailable && p.meta?.is_on_waivers === true) return WAIVER_LIVE;
  if (p.meta?.waiv === true || parseCSVBoolean(p.WAIV)) return WAIVER_EXPORT;
  return null;
}

/**
 * In-game days left on the claim clock, or null. Only StatsPlus knows this, so
 * export-sourced rows always come back null.
 */
export function waiverDaysLeft(p) {
  const d = p.meta?.days_on_waivers_left;
  return typeof d === "number" ? d : null;
}

/**
 * Whether a player can still be claimed. 0 days left means the player has
 * CLEARED waivers — he stays flagged `is_on_waivers` in the StatsPlus dump but
 * is no longer claimable, so he does not belong on the claim board.
 *
 * A null clock (no StatsPlus data for that row) is treated as claimable: the
 * flag says he's on waivers and we have nothing that says otherwise.
 */
export function isClaimable(p) {
  const d = waiverDaysLeft(p);
  return d == null || d > 0;
}

/** Extra fields stamped onto every waiver pool entry by buildBoardPool. */
export const waiverFields = (liveAvailable) => (p) => ({
  _waiverSource: waiverSource(p, liveAvailable),
  _waiverDaysLeft: waiverDaysLeft(p),
});

/**
 * 40-man occupancy for a team. A claim costs a 40-man spot, so the board shows
 * this next to the wire.
 */
export function fortyManSpots(data, team) {
  if (!team) return { used: 0, open: FORTY_MAN_LIMIT, limit: FORTY_MAN_LIMIT };
  const onTeam = (p) => (p.meta?.org ?? p.ORG) === team && p.meta?.on40 === true;
  const used = data.hitters.filter(onTeam).length + data.pitchers.filter(onTeam).length;
  return { used, open: Math.max(0, FORTY_MAN_LIMIT - used), limit: FORTY_MAN_LIMIT };
}
