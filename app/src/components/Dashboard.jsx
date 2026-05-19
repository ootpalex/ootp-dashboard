import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from "react";
import { S } from "../theme.js";
import { DEV_CURVE_DEFAULTS, DEV_CURVE_RANGES, PAGES } from "../utils/constants.js";
import { loadLeagueSettings, saveLeagueSettings, detectExcludedTeams } from "../utils/settings.js";
import { processData, isMatured, isAgeMatured, calcBestPos, recomputeAges } from "../utils/dataProcessing.js";
import { calcPositionalStrength } from "../utils/strength.js";
import { getMaxWar, getMaxWarP, pickPitcherRole } from "../utils/accessors.js";
import { calcFutureValue, devPercentileRank } from "../utils/futureValue.js";
import { calcRawIntangibles } from "../utils/helpers.js";
import { useLocalStorage, useScopedLocalStorage } from "../hooks/useLocalStorage.js";
import OrgView from "../views/Org/OrgView.jsx";
import PlayersView from "./PlayersView.jsx";
import FreeAgentFinder from "./FreeAgentFinder.jsx";
import DraftBoard from "./DraftBoard.jsx";
import IAFABoard from "./IAFABoard.jsx";
import ScoutView from "./ScoutView.jsx";
import Rule5Board from "./Rule5Board.jsx";
import ProspectsView from "./ProspectsView.jsx";
import LeagueSettingsModal from "./LeagueSettingsModal.jsx";
import PlayerProfileModal from "../views/PlayerProfile/PlayerProfileModal.jsx";

// Heaviest deferrable pages — split into their own chunks so the initial
// bundle doesn't pay for them until the user opens the page.
const DevAnalysisView = lazy(() => import("../views/DevAnalysis/DevAnalysisView.jsx"));
const PlayerCompareView = lazy(() => import("./PlayerCompareView.jsx"));
const RosterPlanner = lazy(() => import("../views/RosterPlanner/RosterPlanner.jsx"));

const PAGE_FALLBACK = (
  <div style={{ padding: 24, color: "#64748b", fontSize: 12 }}>Loading…</div>
);

export default function Dashboard({ rawHitters, rawPitchers, platoonSplits, dashMeta, leagues = [], currentLeague = null, onSelectLeague }) {
  // Dashboard is keyed on activeSlug in App.jsx, so this lazy init runs fresh
  // on every league switch — reading the correct league's scoped settings
  // each time. No reload effect needed.
  const [leagueSettings, setLeagueSettings] = useState(loadLeagueSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  // Auto-detect excluded teams from raw data
  const autoExcluded = useMemo(() => detectExcludedTeams([...rawHitters, ...rawPitchers]), [rawHitters, rawPitchers]);
  const allRawTeams = useMemo(() => {
    const teams = new Set();
    [...rawHitters, ...rawPitchers].forEach((r) => { const org = (r.meta?.org ?? r.ORG ?? "").trim(); if (org && org !== "0" && org !== "-") teams.add(org); });
    return [...teams].sort();
  }, [rawHitters, rawPitchers]);

  // Build filtered orgs set from settings + auto-detection
  const filteredOrgs = useMemo(() => {
    const excluded = new Set(["", "0"]);
    autoExcluded.forEach((t) => excluded.add(t));
    (leagueSettings.manualExclusions || []).forEach((t) => excluded.add(t));
    (leagueSettings.manualInclusions || []).forEach((t) => excluded.delete(t));
    return excluded;
  }, [autoExcluded, leagueSettings.manualExclusions, leagueSettings.manualInclusions]);

  // Process data with current exclusions
  const data = useMemo(() => processData(rawHitters, rawPitchers, filteredOrgs), [rawHitters, rawPitchers, filteredOrgs]);

  // Update browser title
  useEffect(() => { document.title = `${leagueSettings.leagueName || "SSB"} GM Dashboard`; }, [leagueSettings.leagueName]);

  const handleSaveSettings = useCallback((newSettings) => {
    setLeagueSettings(newSettings);
    setShowSettings(false);
  }, []);

  // Page-level callback: persist + propagate a partial settings update without
  // closing any modal. DraftBoard uses this to mirror its on-page Draft Settings
  // controls into the same `league_settings` localStorage entry the modal uses.
  const handleUpdateLeagueSettings = useCallback((partial) => {
    setLeagueSettings((prev) => {
      const next = { ...prev, ...partial };
      saveLeagueSettings(next);
      return next;
    });
  }, []);

  const visiblePages = useMemo(() => {
    const presence = dashMeta?.csvPresence || {};
    return PAGES.filter((pg) => !pg.requires || presence[pg.requires] !== false);
  }, [dashMeta]);
  const [activePage, setActivePage] = useState(() => visiblePages[0]?.id || "org");
  useEffect(() => {
    if (!visiblePages.some((pg) => pg.id === activePage)) {
      setActivePage(visiblePages[0]?.id || "org");
    }
  }, [visiblePages, activePage]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [myTeam, setMyTeam] = useScopedLocalStorage("ssb_my_team", "");
  const [gameDate, setGameDate] = useScopedLocalStorage("ssb_game_date", dashMeta?.gameDate || "");

  // The pipeline pulls the current in-game date from StatsPlus and ships it
  // in `dashMeta.gameDate`. Treat that as authoritative — whenever a fresh
  // dashboard arrives with a newer game date than what's persisted, sync to
  // it (and persist via the setter so it sticks across league switches).
  // The user can still override via the sidebar input afterwards; the next
  // pipeline run will overwrite again.
  useEffect(() => {
    const fresh = dashMeta?.gameDate;
    if (fresh && fresh !== gameDate) {
      setGameDate(fresh);
    }
    // We intentionally do NOT depend on `gameDate` here — that would cause
    // every user edit to be reverted to dashMeta.gameDate on the next render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashMeta?.gameDate]);
  const [strengthMode, setStrengthMode] = useState("current");
  const [curveSettings, setCurveSettings] = useState(() => {
    // Bumped on each defaults change so prior auto-saved blobs reset cleanly.
    // v21 — three-input simplification with power-law creditAge.
    // Two exposed knobs: gapMax, gapExp.
    const CURRENT_VERSION = "v21-power-v1";
    const writeAndReturn = (obj) => {
      try { localStorage.setItem("ssb_dev_curve_settings", JSON.stringify(obj)); } catch {}
      return obj;
    };
    try {
      const saved = JSON.parse(localStorage.getItem("ssb_dev_curve_settings") || "{}");
      const isOldFormat = !saved || saved._version !== CURRENT_VERSION;
      if (isOldFormat) {
        // Eagerly write the reset back so stale v20-era keys
        // (riskMin/riskMax/kBase/kMax/gapExp/etc.) don't linger and confuse
        // anyone reading the blob directly via DevTools.
        return writeAndReturn({ ...DEV_CURVE_DEFAULTS, _version: CURRENT_VERSION });
      }
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      return {
        gapMax:        clamp(saved.gapMax        ?? DEV_CURVE_DEFAULTS.gapMax,        DEV_CURVE_RANGES.gapMax.min,        DEV_CURVE_RANGES.gapMax.max),
        gapExp:        clamp(saved.gapExp        ?? DEV_CURVE_DEFAULTS.gapExp,        DEV_CURVE_RANGES.gapExp.min,        DEV_CURVE_RANGES.gapExp.max),
        maxCurrentAge: clamp(saved.maxCurrentAge ?? DEV_CURVE_DEFAULTS.maxCurrentAge, DEV_CURVE_RANGES.maxCurrentAge.min, DEV_CURVE_RANGES.maxCurrentAge.max),
        bandwidth:     clamp(saved.bandwidth     ?? DEV_CURVE_DEFAULTS.bandwidth,     DEV_CURVE_RANGES.bandwidth.min,     DEV_CURVE_RANGES.bandwidth.max),
        _version:      CURRENT_VERSION,
      };
    } catch {
      return writeAndReturn({ ...DEV_CURVE_DEFAULTS, _version: CURRENT_VERSION });
    }
  });
  const updateCurveSettings = useCallback((updates) => {
    setCurveSettings((prev) => {
      const next = { ...prev, ...updates };
      try { localStorage.setItem("ssb_dev_curve_settings", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  useEffect(() => { if (!myTeam && data.teams.length > 0) setMyTeam(data.teams[0]); }, [data.teams]);
  const datedData = useMemo(() => recomputeAges(data, gameDate), [data, gameDate]);

  const enrichedData = useMemo(() => {
    const devCurves = dashMeta?.devCurve ?? null;
    const hitCurve = devCurves?.hit ?? null;

    const enrichHitter = (p) => {
      const matured = isMatured(p, curveSettings);
      const ageMatured = isAgeMatured(p, curveSettings);
      const cur = getMaxWar(p);
      const pot = getMaxWarP(p);
      // v21: Dev% is the player's cur-WAR percentile within their age cohort
      // (display only — not in the FV formula). Unified on cur-WAR across all
      // three cohorts (hitter `maxWar.wtd`, SP `sp.wtd.war`, RP scaled `rp.wtd.war`).
      const devPct = (ageMatured || hitCurve == null || cur == null) ? null
        : devPercentileRank(hitCurve, p._age, cur);
      const cohortCurve = ageMatured ? null : hitCurve;
      const fv = (matured || cur == null) ? cur :
        calcFutureValue(cur, pot, p._age, curveSettings);
      return { ...p, _matured: matured, _ageMatured: ageMatured, _devPct: devPct, _devCurve: cohortCurve, _fv: fv };
    };

    const enrichPitcher = (p) => {
      const matured = isMatured(p, curveSettings);
      const ageMatured = isAgeMatured(p, curveSettings);
      // pickPitcherRole returns scaled cur/pot for the chosen role plus the
      // cohort-specific dev curve, devPct, and FV. Pass null curveSettings
      // when matured so it falls back to cur instead of running the formula.
      const r = pickPitcherRole(p, ageMatured ? null : devCurves, ageMatured ? null : curveSettings, 'best');
      const role = r.role;

      // Build per-role companion blocks for downstream views (FV projection
      // chart, etc.) that compare SP vs RP outcomes.
      const spRoleResult  = pickPitcherRole(p, ageMatured ? null : devCurves, ageMatured ? null : curveSettings, 'sp');
      const rpRoleResult  = pickPitcherRole(p, ageMatured ? null : devCurves, ageMatured ? null : curveSettings, 'rp');
      const _sp = { war: spRoleResult.war, warP: spRoleResult.warP, fv: spRoleResult.fv };
      const _rp = { war: rpRoleResult.war, warP: rpRoleResult.warP, warScaled: rpRoleResult.warSort, warPScaled: rpRoleResult.warPSort, fv: rpRoleResult.fv };

      const bestPos = matured ? calcBestPos(p, "pitcher", true) : p._bestPos;
      return { ...p, _matured: matured, _ageMatured: ageMatured,
        _devPct: ageMatured ? null : r.devPct,
        _devCurve: r.devCurve,
        _sp, _rp, _role: role,
        _war: r.war, _warP: r.warP,
        _warSort: r.warSort, _warPSort: r.warPSort,
        _fv: r.fv,
        _bestPos: bestPos };
    };

    const enrichedHitters = datedData.hitters.map(enrichHitter);
    const enrichedPitchers = datedData.pitchers.map(enrichPitcher);

    const rawScores = [...enrichedHitters, ...enrichedPitchers]
      .map(p => calcRawIntangibles(p)).filter(v => v != null);
    let intMean = 0, intStd = 1;
    if (rawScores.length > 0) {
      intMean = rawScores.reduce((a, b) => a + b, 0) / rawScores.length;
      const variance = rawScores.map(v => (v - intMean) ** 2).reduce((a, b) => a + b, 0) / rawScores.length;
      intStd = Math.sqrt(variance) || 1;
    }
    const addIntGrade = (p) => {
      const raw = calcRawIntangibles(p);
      const grade = raw != null ? Math.round(Math.max(20, Math.min(80, 50 + 10 * (raw - intMean) / intStd))) : null;
      return { ...p, _intangibles: grade };
    };

    return {
      ...datedData,
      hitters: enrichedHitters.map(addIntGrade),
      pitchers: enrichedPitchers.map(addIntGrade),
      meta: { ...(datedData.meta || {}), ...(dashMeta || {}) },
    };
  }, [datedData, curveSettings, dashMeta]);

  const strength = useMemo(() => calcPositionalStrength(enrichedData.hitters, enrichedData.pitchers, enrichedData.teams), [enrichedData]);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "linear-gradient(145deg, #0c1222 0%, #0f172a 50%, #0c1222 100%)", fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace", color: "#cbd5e1" }}>
      {/* Sidebar */}
      <nav role="navigation" aria-label="Main navigation" style={{ width: sidebarOpen ? 220 : 52, background: "rgba(15,23,42,0.8)", borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column", transition: "width 0.2s", flexShrink: 0, position: "sticky", top: 0, height: "100vh", overflowY: "auto" }}>
        <div style={{ padding: sidebarOpen ? "16px 16px 8px" : "16px 8px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {sidebarOpen && <span style={{ fontSize: 20, fontWeight: 800, color: "#e2e8f0", letterSpacing: -1 }}>{leagueSettings.leagueName || "SSB"}</span>}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 16, padding: 4 }}>{sidebarOpen ? "◀" : "▶"}</button>
        </div>
        {sidebarOpen && (
          <div style={{ padding: "8px 12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {leagues.length > 1 && (
              <div>
                <label style={{ fontSize: 10, color: "#475569", letterSpacing: 1, textTransform: "uppercase" }}>League</label>
                <select
                  value={currentLeague || ""}
                  onChange={(e) => onSelectLeague && onSelectLeague(e.target.value)}
                  style={{ ...S.filterSelect, width: "100%", marginTop: 4 }}
                >
                  {leagues.map((l) => (
                    <option key={l.slug} value={l.slug}>
                      {l.leagueName} (OOTP {l.ootpVersion})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label style={{ fontSize: 10, color: "#475569", letterSpacing: 1, textTransform: "uppercase" }}>My Team</label>
              <select value={myTeam} onChange={(e) => setMyTeam(e.target.value)} style={{ ...S.filterSelect, width: "100%", marginTop: 4 }}>
                {data.teams.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, color: "#475569", letterSpacing: 1, textTransform: "uppercase" }}>Game Date</label>
              <input type="date" value={gameDate} onChange={(e) => setGameDate(e.target.value)}
                style={{ ...S.filterSelect, width: "100%", marginTop: 4 }} />
            </div>
          </div>
        )}
        <div role="tablist" aria-label="Page navigation" style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 8px", flex: 1 }}>
          {visiblePages.map((pg) => (
            <button key={pg.id} role="tab" aria-selected={activePage === pg.id} aria-label={pg.label} onClick={() => setActivePage(pg.id)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: sidebarOpen ? "8px 10px" : "8px",
              borderRadius: 6, background: activePage === pg.id ? "rgba(96,165,250,0.15)" : "transparent",
              border: activePage === pg.id ? "1px solid rgba(96,165,250,0.3)" : "1px solid transparent",
              color: activePage === pg.id ? "#93c5fd" : "#64748b", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit", textAlign: "left", transition: "all 0.15s", width: "100%",
            }}>
              <span style={{ fontSize: 16 }}>{pg.icon}</span>
              {sidebarOpen && <span>{pg.label}</span>}
            </button>
          ))}
        </div>
        <div style={{ padding: "8px", borderTop: "1px solid #1e293b" }}>
          <button onClick={() => setShowSettings(true)} aria-label="League settings" style={{
            display: "flex", alignItems: "center", gap: 10, padding: sidebarOpen ? "8px 10px" : "8px",
            borderRadius: 6, background: "transparent", border: "1px solid transparent",
            color: "#64748b", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit", textAlign: "left", transition: "all 0.15s", width: "100%",
          }}>
            <span style={{ fontSize: 16 }}>&#9881;</span>
            {sidebarOpen && <span>Settings</span>}
          </button>
        </div>
      </nav>
      {showSettings && <LeagueSettingsModal settings={leagueSettings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} autoExcluded={autoExcluded} allTeams={allRawTeams} />}

      {/* Main Content */}
      <div style={{ flex: 1, padding: 24, maxWidth: 1400, overflowX: "hidden" }}>
        <Suspense fallback={PAGE_FALLBACK}>
          {activePage === "org" && myTeam && <OrgView data={enrichedData} team={myTeam} strength={strength} strengthMode={strengthMode} setStrengthMode={setStrengthMode} curveSettings={curveSettings} onSelectPlayer={setSelectedPlayer} />}
          {activePage === "players" && <PlayersView data={enrichedData} curveSettings={curveSettings} leagueSettings={leagueSettings} onSelectPlayer={setSelectedPlayer} />}
          {activePage === "fa" && myTeam && <FreeAgentFinder data={enrichedData} myTeam={myTeam} strength={strength} curveSettings={curveSettings} leagueSettings={leagueSettings} onSelectPlayer={setSelectedPlayer} />}
          {activePage === "draft" && myTeam && <DraftBoard data={enrichedData} myTeam={myTeam} strength={strength} curveSettings={curveSettings} leagueSettings={leagueSettings} onUpdateLeagueSettings={handleUpdateLeagueSettings} onSelectPlayer={setSelectedPlayer} />}
          {activePage === "iafa" && <IAFABoard data={enrichedData} myTeam={myTeam} strength={strength} curveSettings={curveSettings} leagueSettings={leagueSettings} onSelectPlayer={setSelectedPlayer} />}
          {activePage === "dev" && <DevAnalysisView data={enrichedData} curveSettings={curveSettings} updateCurveSettings={updateCurveSettings} />}
          {activePage === "scout" && myTeam && <ScoutView data={enrichedData} myTeam={myTeam} strength={strength} strengthMode={strengthMode} setStrengthMode={setStrengthMode} curveSettings={curveSettings} onSelectPlayer={setSelectedPlayer} />}
          {activePage === "compare" && <PlayerCompareView data={enrichedData} curveSettings={curveSettings} />}
          {activePage === "r5" && myTeam && <Rule5Board data={enrichedData} myTeam={myTeam} strength={strength} curveSettings={curveSettings} onSelectPlayer={setSelectedPlayer} />}
          {activePage === "prospects" && <ProspectsView data={enrichedData} curveSettings={curveSettings} leagueSettings={leagueSettings} onSelectPlayer={setSelectedPlayer} />}
          {activePage === "roster" && myTeam && <RosterPlanner data={enrichedData} myTeam={myTeam} curveSettings={curveSettings} leagueSettings={leagueSettings} dashMeta={dashMeta} onSelectPlayer={setSelectedPlayer} />}
        </Suspense>
      </div>
      {selectedPlayer && (
        <PlayerProfileModal
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
          data={enrichedData}
          curveSettings={curveSettings}
          gameDate={gameDate}
        />
      )}
    </div>
  );
}
