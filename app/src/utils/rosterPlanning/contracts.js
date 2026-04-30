// StatsPlus Contract API + per-year salary resolution.
import Papa from "papaparse";

/**
 * Fetch and parse contract data from the StatsPlus API.
 * Returns a Map<playerId, contractInfo> where contractInfo has:
 *   { salaries: number[], years, currentYear, seasonYear,
 *     lastYearTeamOption, lastYearPlayerOption, lastYearVestingOption,
 *     nextLastYearTeamOption, nextLastYearPlayerOption, nextLastYearVestingOption,
 *     lastYearOptionBuyout, nextLastYearOptionBuyout,
 *     noTrade, extension: null | contractInfo }
 */
export async function fetchContracts(statsplusBase) {
  const contracts = new Map();

  try {
    const [contractResp, extResp] = await Promise.all([
      fetch(`${statsplusBase}/contract`).then(r => r.ok ? r.text() : ""),
      fetch(`${statsplusBase}/contractextension`).then(r => r.ok ? r.text() : "").catch(() => ""),
    ]);

    const parseCSV = (text) => {
      if (!text) return [];
      const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
      return parsed.data || [];
    };

    const parseRow = (row) => {
      const salaries = [];
      for (let i = 0; i <= 14; i++) {
        const v = parseInt(row[`salary${i}`], 10);
        salaries.push(isNaN(v) ? 0 : v);
      }
      const years = parseInt(row.years, 10) || 0;
      const trimmed = salaries.slice(0, Math.max(years, 1));

      return {
        playerId: String(row.player_id),
        teamId: row.team_id,
        seasonYear: parseInt(row.season_year, 10) || 0,
        years,
        currentYear: parseInt(row.current_year, 10) || 0,
        salaries: trimmed,
        lastYearTeamOption: row.last_year_team_option === "1",
        lastYearPlayerOption: row.last_year_player_option === "1",
        lastYearVestingOption: row.last_year_vesting_option === "1",
        nextLastYearTeamOption: row.next_last_year_team_option === "1",
        nextLastYearPlayerOption: row.next_last_year_player_option === "1",
        nextLastYearVestingOption: row.next_last_year_vesting_option === "1",
        lastYearOptionBuyout: parseInt(row.last_year_option_buyout, 10) || 0,
        nextLastYearOptionBuyout: parseInt(row.next_last_year_option_buyout, 10) || 0,
        noTrade: row.no_trade === "1",
        extension: null,
      };
    };

    for (const row of parseCSV(contractResp)) {
      const c = parseRow(row);
      if (c.years > 0 || c.salaries.some(s => s > 0)) {
        contracts.set(c.playerId, c);
      }
    }

    for (const row of parseCSV(extResp)) {
      const ext = parseRow(row);
      if (ext.years > 0 || ext.salaries.some(s => s > 0)) {
        const base = contracts.get(ext.playerId);
        if (base) {
          base.extension = ext;
        } else {
          contracts.set(ext.playerId, { ...ext, isExtensionOnly: true });
        }
      }
    }
  } catch (e) {
    console.warn("Failed to fetch StatsPlus contracts:", e);
  }

  return contracts;
}

/**
 * Resolve the salary for a given calendar year from StatsPlus contract data.
 * Returns { salary, optionType, buyout } or null if no data.
 */
export function resolveContractYear(contract, calendarYear) {
  if (!contract) return null;

  const yearIndex = contract.currentYear + (calendarYear - (contract.seasonYear + contract.currentYear));

  if (yearIndex >= 0 && yearIndex < contract.years) {
    const salary = contract.salaries[yearIndex] || 0;
    let optionType = null;
    let buyout = 0;

    if (yearIndex === contract.years - 1) {
      if (contract.lastYearTeamOption) { optionType = "club"; buyout = contract.lastYearOptionBuyout; }
      else if (contract.lastYearPlayerOption) { optionType = "player"; buyout = contract.lastYearOptionBuyout; }
      else if (contract.lastYearVestingOption) { optionType = "vesting"; }
    }
    if (yearIndex === contract.years - 2) {
      if (contract.nextLastYearTeamOption) { optionType = "club"; buyout = contract.nextLastYearOptionBuyout; }
      else if (contract.nextLastYearPlayerOption) { optionType = "player"; buyout = contract.nextLastYearOptionBuyout; }
      else if (contract.nextLastYearVestingOption) { optionType = "vesting"; }
    }

    return { salary, optionType, buyout };
  }

  if (contract.extension) {
    const extStart = contract.seasonYear + contract.years;
    const extIndex = calendarYear - extStart;
    if (extIndex >= 0 && extIndex < contract.extension.years) {
      const salary = contract.extension.salaries[extIndex] || 0;
      let optionType = null;
      let buyout = 0;

      if (extIndex === contract.extension.years - 1) {
        if (contract.extension.lastYearTeamOption) { optionType = "club"; buyout = contract.extension.lastYearOptionBuyout; }
        else if (contract.extension.lastYearPlayerOption) { optionType = "player"; buyout = contract.extension.lastYearOptionBuyout; }
        else if (contract.extension.lastYearVestingOption) { optionType = "vesting"; }
      }
      if (extIndex === contract.extension.years - 2) {
        if (contract.extension.nextLastYearTeamOption) { optionType = "club"; buyout = contract.extension.nextLastYearOptionBuyout; }
        else if (contract.extension.nextLastYearPlayerOption) { optionType = "player"; buyout = contract.extension.nextLastYearOptionBuyout; }
        else if (contract.extension.nextLastYearVestingOption) { optionType = "vesting"; }
      }

      return { salary, optionType, buyout };
    }
  }

  return null;
}
