// Roster crunch warnings and suggested actions.

export function analyzeCrunch(projection, year) {
  const warnings = [];
  const { buckets, fortyManCount } = projection;

  if (fortyManCount > 40) {
    warnings.push({
      type: "over40", severity: "error",
      message: `40-man roster has ${fortyManCount} players (${fortyManCount - 40} over limit)`,
    });
  }

  const r5Count = buckets.r5Risk.length;
  if (r5Count > 0) {
    warnings.push({
      type: "r5", severity: "warning",
      message: `${r5Count} prospect${r5Count > 1 ? "s" : ""} becoming Rule 5 eligible — protect or risk losing them`,
    });
  }

  // Out-of-options: only flag inactive 40-man (the real roster squeeze)
  const oooPlayers = (buckets.fortyMan || []).filter(ep => ep._options.outOfOptions);
  if (oooPlayers.length > 0) {
    warnings.push({
      type: "options", severity: "warning",
      message: `${oooPlayers.length} inactive 40-man player${oooPlayers.length > 1 ? "s" : ""} out of options — must roster or expose to waivers`,
    });
  }

  const mlfaRisk = (buckets.prospects || []).filter(ep =>
    ep._mlfa.mlfaYear <= year + 1 && !ep._mlfa.eligible
  );
  if (mlfaRisk.length > 0) {
    warnings.push({
      type: "mlfa", severity: "info",
      message: `${mlfaRisk.length} prospect${mlfaRisk.length > 1 ? "s" : ""} approaching minor league free agency`,
    });
  }

  const openSlots = 40 - fortyManCount;
  if (r5Count > openSlots && openSlots >= 0) {
    warnings.push({
      type: "crunch", severity: "error",
      message: `Need ${r5Count} slots for R5 protection but only ${openSlots} open — must clear ${r5Count - openSlots} spot${r5Count - openSlots > 1 ? "s" : ""}`,
    });
  }

  return warnings;
}

export function suggestActions(projection, curveSettings) {
  const suggestions = [];
  const { buckets } = projection;

  const fortyManAll = [...(buckets.active || []), ...(buckets.fortyMan || [])];
  const dfaCandidates = [...fortyManAll]
    .sort((a, b) => {
      if (a._options.outOfOptions && !b._options.outOfOptions) return -1;
      if (!a._options.outOfOptions && b._options.outOfOptions) return 1;
      return (a._fv ?? a._waa ?? 0) - (b._fv ?? b._waa ?? 0);
    })
    .slice(0, 5);

  dfaCandidates.forEach(ep => {
    const reason = ep._options.outOfOptions
      ? `Out of options, FV ${ep._fv != null ? ep._fv.toFixed(1) : "N/A"}`
      : `Lowest FV on 40-man (${ep._fv != null ? ep._fv.toFixed(1) : "N/A"})`;
    suggestions.push({ type: "dfa", playerId: ep._uid, player: ep, reason, action: "dfa" });
  });

  (buckets.r5Risk || []).forEach(ep => {
    suggestions.push({
      type: "protect", playerId: ep._uid, player: ep,
      reason: `R5-eligible${ep._r5.r5Countdown === 0 ? " now" : ` in ${ep._r5.r5Countdown} yr`}, FV ${ep._fv != null ? ep._fv.toFixed(1) : "N/A"}`,
      action: "protect",
    });
  });

  const promoteCandidates = (buckets.fortyMan || [])
    .filter(ep => !ep.meta?.act && (ep._waa ?? -999) > 0)
    .sort((a, b) => (b._waa ?? 0) - (a._waa ?? 0))
    .slice(0, 3);

  promoteCandidates.forEach(ep => {
    suggestions.push({
      type: "promote", playerId: ep._uid, player: ep,
      reason: `WAA ${ep._waa != null ? ep._waa.toFixed(1) : "N/A"} — ready for active roster`,
      action: "promote",
    });
  });

  const mlfaCandidates = (buckets.prospects || [])
    .filter(ep =>
      ep._mlfa?.mlfaYear != null &&
      ep._mlfa.mlfaYear <= projection.gameYear + 2 &&
      !ep._mlfa.eligible
    )
    .sort((a, b) => (b._fv ?? b._waa ?? 0) - (a._fv ?? a._waa ?? 0))
    .slice(0, 5);

  mlfaCandidates.forEach(ep => {
    const yr = ep._mlfa.mlfaYear;
    suggestions.push({
      type: "milfa", playerId: ep._uid, player: ep,
      reason: `MiLB FA after ${yr - 1} season — FV ${ep._fv != null ? ep._fv.toFixed(1) : "N/A"}, re-sign or add to 40-man`,
      action: "protect",
    });
  });

  return suggestions;
}
