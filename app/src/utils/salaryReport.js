// ============================================================================
// SALARY REPORT — Fetch and parse StatsPlus team salary projection HTML pages
// URL pattern: {statsBase}/reports/news/html/teams/team_{id}_player_salary_report.html
// Provides 10-year salary/arb projections for all 40-man players.
// ============================================================================

// Module-level cache: team name → numeric ID, populated on first /teams/ fetch.
let teamIdCache = null;

/**
 * Fetch the team ID for a given team name from the StatsPlus /teams/ endpoint.
 * The endpoint returns CSV with columns: ID, Name, Nickname, Parent Team ID.
 * Full team name = "Name Nickname" (e.g. "Atlanta" + "Braves" = "Atlanta Braves").
 * Returns null if the team cannot be found.
 */
export async function fetchTeamId(myTeam, statsBase) {
  if (!myTeam || !statsBase) return null;
  if (!teamIdCache) {
    try {
      const res = await fetch(`${statsBase}/teams/`);
      if (!res.ok) return null;
      const text = await res.text();
      // Parse CSV: first line is headers, remaining lines are data
      const lines = text.trim().split(/\r?\n/);
      const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
      const idIdx = headers.indexOf("id");
      const nameIdx = headers.indexOf("name");
      const nickIdx = headers.indexOf("nickname");
      teamIdCache = new Map();
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map(c => c.trim());
        const id = cols[idIdx];
        const fullName = `${cols[nameIdx] ?? ""} ${cols[nickIdx] ?? ""}`.trim();
        if (id && fullName) teamIdCache.set(fullName.toLowerCase(), id);
      }
    } catch {
      return null;
    }
  }
  return teamIdCache.get(myTeam.toLowerCase()) ?? null;
}

/**
 * Parse a cell's text content and return { salary, type, guaranteed }.
 * Notation catalog (from sampling 8 teams):
 *   (*)  milb        — on MLB-min deal, paid 16.5% while in minors
 *   MiLC milc        — formal minor league contract, no MLB service clock
 *   (A)  arb         — confirmed arb eligible
 *   (A*) arb_uncertain — possibly arb, else auto-renew
 *   (A#) arb_uncertain — possible FA eligible, else arb (treated same as A*)
 *   (T)  team_option
 *   (P)  player_option
 *   (V)  vesting_option
 *   (O)  opt_out     — player holds opt-out after this season
 *   (R)  retained    — salary subsidized by trading team
 *   —    fa          — expired / no salary
 */
function parseCell(rawHtml) {
  const isItalic = /<[ie][m>]/.test(rawHtml); // <i> or <em>

  // Strip all HTML tags
  const text = rawHtml.replace(/<[^>]+>/g, "").trim();

  if (!text || text === "—" || text === "-") {
    return { salary: null, type: "fa", guaranteed: false };
  }

  if (text === "MiLC") {
    return { salary: null, type: "milc", guaranteed: false };
  }

  // Detect annotation suffix (must be checked longest-first to avoid partial matches)
  let type = "signed";
  let salaryStr = text;

  const annotations = [
    ["(A*)", "arb_uncertain"],
    ["(A#)", "arb_uncertain"],
    ["(A)",  "arb"],
    ["(*)",  "milb"],
    ["(T)",  "team_option"],
    ["(P)",  "player_option"],
    ["(V)",  "vesting_option"],
    ["(O)",  "opt_out"],
    ["(R)",  "retained"],
  ];

  for (const [suffix, annotationType] of annotations) {
    if (text.endsWith(suffix)) {
      type = annotationType;
      salaryStr = text.slice(0, -suffix.length).trim();
      break;
    }
  }

  const salary = parseSalaryStr(salaryStr);
  const guaranteed = !isItalic;

  return { salary, type, guaranteed };
}

function parseSalaryStr(s) {
  if (!s) return null;
  const clean = s.replace(/\$/g, "").trim().toLowerCase();
  if (clean.endsWith("m")) return Math.round(parseFloat(clean) * 1_000_000);
  if (clean.endsWith("k")) return Math.round(parseFloat(clean) * 1_000);
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

/**
 * Parse the salary report HTML page.
 * Returns Map<playerId(string), { name, pos, years: { [year]: { salary, type, guaranteed } } }>.
 */
export function parseSalaryReportHtml(html) {
  const result = new Map();

  // Extract column year headers from <th> cells
  const yearCols = [];
  const thPattern = /<th[^>]*>(.*?)<\/th>/gi;
  let thMatch;
  while ((thMatch = thPattern.exec(html)) !== null) {
    const cellText = thMatch[1].replace(/<[^>]+>/g, "").trim();
    if (/^\d{4}$/.test(cellText)) yearCols.push(parseInt(cellText, 10));
  }

  if (yearCols.length === 0) return result;

  // Walk table rows
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const rowHtml = rowMatch[1];

    // Find player link: <a href="../players/player_NNN.html">Name</a>
    const linkMatch = rowHtml.match(/href="[^"]*\/player_(\d+)\.html"[^>]*>([^<]+)<\/a>/i);
    if (!linkMatch) continue; // Skip total row and header rows

    const playerId = linkMatch[1];
    const playerName = linkMatch[2].trim();

    // Extract position from first <td>
    const firstTd = rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
    const pos = firstTd ? firstTd[1].replace(/<[^>]+>/g, "").trim() : "";

    // Extract all <td> cells
    const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const tds = [];
    let tdMatch;
    while ((tdMatch = tdPattern.exec(rowHtml)) !== null) {
      tds.push(tdMatch[1]);
    }

    // The salary year columns start after Pos, Name, Age (3 columns)
    const salaryCells = tds.slice(3);

    const years = {};
    salaryCells.forEach((cellHtml, i) => {
      if (i >= yearCols.length) return;
      const year = yearCols[i];
      years[year] = parseCell(cellHtml);
    });

    result.set(playerId, { name: playerName, pos, years });
  }

  return result;
}

/**
 * Fetch and parse the salary report HTML for a given team ID.
 * pageBase: the StatsPlus site root (no /api), e.g. https://atl-01.statsplus.net/ssb
 */
export async function fetchSalaryReport(teamId, pageBase) {
  if (!teamId || !pageBase) return null;
  const url = `${pageBase}/reports/news/html/teams/team_${teamId}_player_salary_report.html`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Salary report fetch failed (${res.status}): ${url}`);
  const html = await res.text();
  return parseSalaryReportHtml(html);
}

// ---------------------------------------------------------------------------
// Draft date lookup
// ---------------------------------------------------------------------------

const TXNDT_MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function parseTxnDate(str) {
  if (!str) return null;
  // Format: "Jun. 3rd   2041" or "Jun. 3rd, 2041"
  const parts = str.trim().split(/[\s.,]+/).filter(Boolean);
  const mon = TXNDT_MONTHS[parts[0]];
  const day = parseInt(parts[1]);
  const year = parseInt(parts[2] || parts[3]);
  if (isNaN(mon) || isNaN(day) || isNaN(year)) return null;
  return new Date(year, mon, day);
}

/**
 * Parse a player's history page HTML to find the date of the amateur draft transaction.
 * Looks for table rows containing draftYear and the word "Draft".
 */
function parseDraftDateFromHistory(html, draftYear) {
  const yearStr = String(draftYear);
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowPattern.exec(html)) !== null) {
    const row = m[1];
    if (!row.includes(yearStr)) continue;
    if (!/draft/i.test(row)) continue;
    // Date is typically in the first <td>
    const tdMatch = row.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
    if (!tdMatch) continue;
    const dateText = tdMatch[1].replace(/<[^>]+>/g, "").trim();
    const date = parseTxnDate(dateText);
    if (date && date.getFullYear() === draftYear) return date;
  }
  return null;
}

/**
 * Fetch exact draft dates for each draft year present in teamPlayers.
 * Fetches one player history page per draft year and parses the draft transaction date.
 * Returns Map<draftYear(number), Date>.
 */
export async function fetchDraftDates(teamPlayers, pageBase) {
  if (!pageBase) return new Map();

  // Collect one player ID per draft year
  const yearToPlayerId = new Map();
  for (const p of teamPlayers) {
    const year = p.meta?.draft;
    if (!year || year === 0 || yearToPlayerId.has(year)) continue;
    yearToPlayerId.set(year, p.id);
  }

  const result = new Map();
  await Promise.all([...yearToPlayerId.entries()].map(async ([year, playerId]) => {
    try {
      const url = `${pageBase}/reports/news/html/players/player_${playerId}.html`;
      const res = await fetch(url);
      if (!res.ok) return;
      const html = await res.text();
      const date = parseDraftDateFromHistory(html, year);
      if (date) result.set(year, date);
    } catch { /* fall back to July 1 in calcR5Projection */ }
  }));

  return result;
}
