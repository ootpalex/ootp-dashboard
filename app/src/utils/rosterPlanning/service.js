// Season-day detection, game-date detection, super-two projection.
import { DAYS_PER_SEASON } from "./_shared.js";

const TWO_YEAR_FLOOR = DAYS_PER_SEASON * 2;        // 344
const THREE_YEAR_FLOOR = DAYS_PER_SEASON * 3;      // 516

/**
 * Detect how many league days into the current season we are by finding the
 * most common MLD remainder (mod 172). Returns 0 at season start.
 */
export function detectSeasonDay(allPlayers) {
  const counts = new Map();
  for (const p of allPlayers) {
    const mld = p.meta?.mld;
    if (mld != null && mld > 0) {
      const rem = mld % DAYS_PER_SEASON;
      counts.set(rem, (counts.get(rem) || 0) + 1);
    }
  }
  if (counts.size === 0) return 0;
  let bestRem = 0, bestCount = 0;
  for (const [rem, cnt] of counts) {
    if (cnt > bestCount) { bestRem = rem; bestCount = cnt; }
  }
  return bestRem;
}

/**
 * Detect post-season limbo: seasonDay==0 AND the just-completed season is
 * already in MLD (so floor(MLD/172) > recorded MLY). MLY only rolls Jan 1.
 *
 * If no player in the pool exposes meta.mly, return false — without MLY data
 * we can't distinguish limbo from genuine pre-Opening-Day. Caller should treat
 * a missing-mly pool as pre-OpDay (the safer default).
 */
export function detectLimbo(allPlayers, seasonDay) {
  if (seasonDay !== 0) return false;
  for (const p of allPlayers) {
    const mly = p.meta?.mly;
    if (mly == null) continue;
    const mld = p.meta?.mld ?? 0;
    if (mld > 0 && Math.floor(mld / DAYS_PER_SEASON) !== mly) return true;
  }
  return false;
}

/**
 * Detect whether arbitration contracts have been signed for the current
 * cycle's S2 class. Only meaningful in limbo: scan the 2.xxx-MLD bucket
 * for any player with an arb-qualifier `yl`. During in-season, prior-cycle
 * S2 players have already moved to 3.xxx; the only way a 2.xxx player
 * carries an arb contract in limbo is if signing just happened this cycle.
 */
export function detectArbSigned(allPlayers) {
  for (const p of allPlayers) {
    const mld = p.meta?.mld ?? 0;
    if (mld < TWO_YEAR_FLOOR || mld >= THREE_YEAR_FLOOR) continue;
    const yl = (p.meta?.yl || "").toLowerCase();
    if (yl.includes("arbitr")) return true;
  }
  return false;
}

/**
 * Detect the in-game date by cross-referencing players' DOB and integer age.
 */
export function detectGameDate(allPlayers) {
  let latestLower = null;
  let earliestUpper = null;

  for (const p of allPlayers) {
    const dob = p.meta?.dob;
    const rawAge = p._age != null ? p._age : p.meta?.age;
    const age = typeof rawAge === "number" ? Math.floor(rawAge) : null;
    if (!dob || age == null || age < 0) continue;

    const dobDate = new Date(dob);
    if (isNaN(dobDate.getTime())) continue;

    const lower = new Date(dobDate);
    lower.setFullYear(dobDate.getFullYear() + age);

    const upper = new Date(dobDate);
    upper.setFullYear(dobDate.getFullYear() + age + 1);

    if (!latestLower || lower > latestLower) latestLower = lower;
    if (!earliestUpper || upper < earliestUpper) earliestUpper = upper;
  }

  return latestLower || null;
}

/**
 * Compute integer days to add to current MLD for a given algoOffset and
 * season state. Returns null when algoOffset < 0 (current-year tab during
 * an active season — the cutoff is already locked, no projection needed).
 *
 * algoOffset is `displayYear - gameYear - 1` — the offset of the SEASON
 * whose end determines the cutoff for `displayYear`'s arb class.
 */
function computeDaysToAdd(seasonDay, limbo, algoOffset) {
  if (algoOffset < 0) return null;
  if (seasonDay > 0) return (DAYS_PER_SEASON - seasonDay) + algoOffset * DAYS_PER_SEASON;
  // seasonDay === 0: limbo means MLD already includes the just-completed
  // season, so don't re-add it. Pre-OpDay means the upcoming season is
  // fully ahead of us.
  if (limbo) return algoOffset * DAYS_PER_SEASON;
  return DAYS_PER_SEASON + algoOffset * DAYS_PER_SEASON;
}

// Free agents (org "-" or "0") are not on any MLB roster, so a stale meta.act
// flag must NOT be enough to project further accrual. Otherwise this mirrors
// the prior accrual rule.
function isAccruing(meta) {
  const org = meta.org;
  if (org === "-" || org === "0") return false;
  if (meta._ilShort === true || meta._ilLong === true) return true;
  if (meta.act === true && meta.lev === "MLB") return true;
  if (meta.ic && meta.ic !== "-" && meta.ic !== "" && meta.lev === "MLB") return true;
  return false;
}

/**
 * Per-player integer projection. Active or IL'd MLB players accrue the full
 * daysToAdd window; inactive 40-man and minor-leaguers do not. When
 * daysToAdd is null (current-year case), MLD is returned as-is.
 */
function projectMLD(player, daysToAdd) {
  const meta = player.meta || player;
  const mld = meta.mld ?? 0;
  if (daysToAdd == null) return mld;
  return isAccruing(meta) ? mld + daysToAdd : mld;
}

/**
 * Days the player will accrue in the year preceding `displayYear`'s cutoff.
 * The Super-Two rule requires ≥86 in that preceding year. When we lack
 * StatsPlus `mlb_service_days_this_year` data, fall back to "full season if
 * accruing, else 0" — preserves the rule that minors / FAs never qualify.
 */
function accrualPriorYear(player, seasonDay, limbo, algoOffset) {
  const meta = player.meta || player;
  const accruing = isAccruing(meta);
  const spDays = meta.mlb_service_days_this_year;

  if (algoOffset >= 1) return accruing ? DAYS_PER_SEASON : 0;
  if (seasonDay > 0) {
    const accruedSoFar = spDays ?? 0;
    return accruedSoFar + (accruing ? (DAYS_PER_SEASON - seasonDay) : 0);
  }
  if (limbo) return spDays ?? 0;
  return accruing ? DAYS_PER_SEASON : 0;
}

/**
 * Project Super-Two cutoff for the season whose end determines `displayYear`'s
 * arb class. Caller passes algoOffset = displayYear - gameYear - 1.
 *
 * Returns { cutoffMLD, cutoffLabel, seasonDay, limbo, algoOffset, daysToAdd,
 * candidates: [{ player, currentMLD, projectedMLD, isSuperTwo }] }.
 */
export function projectSuperTwo(allPlayers, opts = {}) {
  const seasonDay = opts.seasonDay != null ? opts.seasonDay : detectSeasonDay(allPlayers);
  const limbo = opts.limbo != null ? opts.limbo : detectLimbo(allPlayers, seasonDay);
  const algoOffset = opts.algoOffset != null ? opts.algoOffset : 0;
  const daysToAdd = computeDaysToAdd(seasonDay, limbo, algoOffset);

  // Project every player, then filter to the projected 2.xxx bucket plus the
  // Super-Two ≥86-day prior-year rule (strips free agents, non-MLB-league
  // players, and players who didn't log meaningful MLB time last year).
  const inClass = [];
  for (const p of allPlayers) {
    const mld = p.meta?.mld ?? 0;
    const projected = projectMLD(p, daysToAdd);
    if (projected < TWO_YEAR_FLOOR || projected >= THREE_YEAR_FLOOR) continue;
    if (accrualPriorYear(p, seasonDay, limbo, algoOffset) < 86) continue;
    inClass.push({ player: p, currentMLD: mld, projectedMLD: projected });
  }

  if (inClass.length === 0) {
    return {
      cutoffMLD: THREE_YEAR_FLOOR,
      cutoffLabel: "3.000",
      cutoffIndex: -1,
      seasonDay, limbo, algoOffset, daysToAdd,
      candidates: [],
    };
  }

  inClass.sort((a, b) => b.projectedMLD - a.projectedMLD);
  const cutoffIndex = Math.max(0, Math.floor(inClass.length * 0.22));
  const cutoffMLD = inClass[cutoffIndex].projectedMLD;
  const cutoffLabel = `${Math.floor(cutoffMLD / DAYS_PER_SEASON)}.${String(cutoffMLD % DAYS_PER_SEASON).padStart(3, "0")}`;

  const candidates = inClass.map(c => ({
    ...c,
    isSuperTwo: c.projectedMLD >= cutoffMLD,
  }));

  return { cutoffMLD, cutoffLabel, cutoffIndex, seasonDay, limbo, algoOffset, daysToAdd, candidates };
}
