import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from "react";
import { S } from "../theme.js";
import { G5_DEFAULTS, PAGES } from "../utils/constants.js";
import { loadLeagueSettings, detectExcludedTeams } from "../utils/settings.js";
import { processData, isMatured, calcBestPos, recomputeAges } from "../utils/dataProcessing.js";
import { calcPositionalStrength } from "../utils/strength.js";
import { getMaxWaa, getMaxWaaP, getBatR, getSpWaa, getRpWaa, getSpWaaP, getRpWaaP, scaleRpWaaP, pickPitcherRole } from "../utils/accessors.js";
import { computeDevPercentile, calcFutureValue } from "../utils/futureValue.js";
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
  const [strengthMode, setStrengthMode] = useState("current");
  const [curveSettings, setCurveSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("ssb_dev_curve_settings"));
      const raw = {
        maxCurrentAge: saved?.maxCurrentAge ?? G5_DEFAULTS.maxCurrentAge,
        riskMin: saved?.riskMin ?? (saved?.riskWeight != null ? (1 - saved.riskWeight) : G5_DEFAULTS.riskMin),
        riskMax: saved?.riskMax ?? G5_DEFAULTS.riskMax,
        riskExp: saved?.riskExp ?? G5_DEFAULTS.riskExp,
        bandwidth: saved?.bandwidth ?? G5_DEFAULTS.bandwidth,
        gapMax: saved?.gapMax ?? (saved?.gapSens ?? G5_DEFAULTS.gapMax),
        gapExp: saved?.gapExp ?? G5_DEFAULTS.gapExp,
        riskMode: (saved?.riskMode === 'power' || saved?.riskMode === 'logit') ? saved.riskMode : (saved?.riskMode === 'sigmoid' ? 'logit' : G5_DEFAULTS.riskMode),
        logitK: saved?.logitK ?? G5_DEFAULTS.logitK,
      };
      raw.maxCurrentAge = Math.max(24, Math.min(32, raw.maxCurrentAge));
      raw.riskMin = Math.max(0, Math.min(1, raw.riskMin));
      raw.riskMax = Math.max(0, Math.min(1, raw.riskMax));
      raw.riskExp = Math.max(0.01, Math.min(100, raw.riskExp));
      raw.gapMax = Math.max(0, Math.min(1.00, raw.gapMax));
      raw.gapExp = Math.max(1, Math.min(20, raw.gapExp));
      raw.logitK = Math.max(0.1, Math.min(2.0, raw.logitK));

      return raw;
    } catch { return { ...G5_DEFAULTS }; }
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
    const hitPeers = datedData.hitters.map(p => ({ age: p._age, currentWAA: getBatR(p) }));
    const pitPeers = datedData.pitchers.map(p => ({
      age: p._age,
      currentWAA: (p.meta?.pos ?? p.POS) === "SP" ? getSpWaa(p) : getRpWaa(p)
    }));

    const enrichHitter = (p) => {
      const matured = isMatured(p, curveSettings);
      const batR = getBatR(p);
      const devPct = matured ? null : computeDevPercentile(batR, p._age, hitPeers, curveSettings.bandwidth);
      const cur = getMaxWaa(p);
      const pot = getMaxWaaP(p);
      const fv = (matured || cur == null) ? cur :
        calcFutureValue(cur, pot, p._age, devPct, curveSettings);
      return { ...p, _matured: matured, _devPct: devPct, _fv: fv };
    };

    const enrichPitcher = (p) => {
      const matured = isMatured(p, curveSettings);
      // Provisional best-of-role pick (no FV yet) so devPct uses the role's
      // current WAA — matches boardUtils.computeDevPercentilesMap semantics.
      const provisional = pickPitcherRole(p, null, null, 'best');
      const devCur = provisional.waa;  // raw RP if RP wins, SP otherwise
      const devPct = matured ? null : computeDevPercentile(devCur, p._age, pitPeers, curveSettings.bandwidth);

      // Compute FV per role with the same devPct, then pick best.
      const spWaa = getSpWaa(p);
      const spWaaP = getSpWaaP(p);
      const rpWaa = getRpWaa(p);
      const rpWaaP = getRpWaaP(p);
      const rpWaaScaled = scaleRpWaaP(rpWaa);
      const rpWaaPScaled = scaleRpWaaP(rpWaaP);
      const fvFor = (cur, pot) => {
        if (cur == null) return null;
        if (matured) return cur;
        return calcFutureValue(cur, pot, p._age, devPct, curveSettings);
      };
      const spFv = fvFor(spWaa, spWaaP);
      const rpFv = fvFor(rpWaaScaled, rpWaaPScaled);  // always SP-scaled

      const useRp = (spWaaP == null) || (rpWaaPScaled != null && rpWaaPScaled > spWaaP);
      const role = useRp ? 'rp' : 'sp';
      const _sp = { waa: spWaa, waaP: spWaaP, fv: spFv };
      const _rp = { waa: rpWaa, waaP: rpWaaP, waaScaled: rpWaaScaled, waaPScaled: rpWaaPScaled, fv: rpFv };
      const _waa = useRp ? rpWaa : spWaa;        // raw display
      const _waaP = useRp ? rpWaaP : spWaaP;     // raw display
      const _waaSort = useRp ? rpWaaScaled : spWaa;
      const _waaPSort = useRp ? rpWaaPScaled : spWaaP;
      const _fv = useRp ? rpFv : spFv;           // already SP-scaled

      const bestPos = matured ? calcBestPos(p, "pitcher", true) : p._bestPos;
      return { ...p, _matured: matured, _devPct: devPct,
        _sp, _rp, _role: role, _waa, _waaP, _waaSort, _waaPSort, _fv,
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
    };
  }, [datedData, curveSettings]);

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
          {activePage === "draft" && myTeam && <DraftBoard data={enrichedData} myTeam={myTeam} strength={strength} curveSettings={curveSettings} leagueSettings={leagueSettings} onSelectPlayer={setSelectedPlayer} />}
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
