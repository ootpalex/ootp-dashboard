// Public barrel for the rosterPlanning util. Existing imports of these
// symbols continue to work via this single entry point.

export { fetchContracts, resolveContractYear } from "./contracts.js";
export { detectSeasonDay, detectLimbo, detectArbSigned, detectGameDate, projectSuperTwo } from "./service.js";
export {
  parseContractStatus,
  calcR5Projection,
  calcMLFA,
  getOptionsInfo,
  R5_DEFAULT_THRESHOLD,
  R5_PROTECT_BUFFER,
  filterR5Protect,
} from "./eligibility.js";
export { buildRosterProjection } from "./projection.js";
export { analyzeCrunch, suggestActions } from "./crunch.js";
export { classifyPitchers, analyzeActiveCoverage, analyzeInactiveCoverage, buildDepthChart } from "./depth.js";
