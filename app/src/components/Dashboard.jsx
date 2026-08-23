import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from "react";
import { TOKENS, S } from "../theme.js";
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
import WaiverWireView from "./WaiverWireView.jsx";
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
  <div style={{ padding: 24, color: TOKENS.text3, fontSize: 12 }}>Loading…</div>
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

  // Process data with current exclusions. `currentLeague` (slug) routes the
  // bestPos defensive-spectrum + arm-threshold lookup to the right universe.
  const data = useMemo(() => processData(rawHitters, rawPitchers, filteredOrgs, currentLeague), [rawHitters, rawPitchers, filteredOrgs, currentLeague]);

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
  const [strengthMode, setStrengthMode] = useState("now");
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
      return { ...p, _matured: matured, _ageMatured: ageMatured, _devPct: devPct, _devCurve: cohortCurve, _fv: fv, _war: cur, _warP: pot };
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

  const strength = useMemo(() => calcPositionalStrength(enrichedData.hitters, enrichedData.pitchers, enrichedData.teams, curveSettings), [enrichedData, curveSettings]);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: TOKENS.bg, fontFamily: TOKENS.fonts.ui, color: TOKENS.text }}>
      {/* Sidebar — Night Scorecard paper panel (batch 1). Collapsed rail (52px)
          shows the page icons only; expanded (200px) shows text rows with the
          red-pencil ✓ on the active page. */}
      <nav role="navigation" aria-label="Main navigation" style={{ width: sidebarOpen ? 200 : 52, background: TOKENS.panel, borderRight: `1px solid ${TOKENS.line2}`, display: "flex", flexDirection: "column", transition: "width 0.2s", flexShrink: 0, position: "sticky", top: 0, height: "100vh", overflowY: "auto", overflowX: "hidden", padding: "14px 0 0" }}>
        <div style={{ padding: sidebarOpen ? "2px 10px 10px 16px" : "2px 0 10px", display: "flex", alignItems: "center", justifyContent: sidebarOpen ? "space-between" : "center", gap: 6, minWidth: 0 }}>
          {sidebarOpen && (
            <span style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, overflow: "hidden" }}>
              <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.04em", color: TOKENS.text, lineHeight: 1.1, whiteSpace: "nowrap" }}>{leagueSettings.leagueName || "SSB"}</span>
              <span style={{ fontFamily: TOKENS.fonts.narrow, fontWeight: 500, fontSize: 12, color: TOKENS.text3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>GM Dashboard</span>
            </span>
          )}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"} style={{ background: "none", border: "none", color: TOKENS.text3, cursor: "pointer", fontSize: 11, padding: "3px 5px", lineHeight: 1, borderRadius: TOKENS.radius, flexShrink: 0 }}>{sidebarOpen ? "◀" : "▶"}</button>
        </div>
        {sidebarOpen && (
          <div style={{ margin: "0 12px 10px", border: `1px solid ${TOKENS.line}`, borderRadius: TOKENS.radius, background: TOKENS.panel2, padding: "8px 10px 9px", display: "flex", flexDirection: "column", gap: 7 }}>
            {leagues.length > 1 && (
              <div>
                <label style={{ display: "block", fontFamily: TOKENS.fonts.narrow, fontSize: 11, fontWeight: 600, color: TOKENS.text3 }}>League</label>
                <select
                  value={currentLeague || ""}
                  onChange={(e) => onSelectLeague && onSelectLeague(e.target.value)}
                  style={{ width: "100%", background: "transparent", border: "none", borderBottom: `1px solid ${TOKENS.line2}`, borderRadius: 0, color: TOKENS.text, fontFamily: TOKENS.fonts.ui, fontSize: 12.5, fontWeight: 600, padding: "3px 0 4px", cursor: "pointer" }}
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
              <label style={{ display: "block", fontFamily: TOKENS.fonts.narrow, fontSize: 11, fontWeight: 600, color: TOKENS.text3 }}>My Team</label>
              <select value={myTeam} onChange={(e) => setMyTeam(e.target.value)} style={{ width: "100%", background: "transparent", border: "none", borderBottom: `1px solid ${TOKENS.line2}`, borderRadius: 0, color: TOKENS.text, fontFamily: TOKENS.fonts.ui, fontSize: 12.5, fontWeight: 600, padding: "3px 0 4px", cursor: "pointer" }}>
                {data.teams.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontFamily: TOKENS.fonts.narrow, fontSize: 11, fontWeight: 600, color: TOKENS.text3 }}>Game Date</label>
              <input type="date" value={gameDate} onChange={(e) => setGameDate(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", background: "transparent", border: "none", borderBottom: `1px solid ${TOKENS.line2}`, borderRadius: 0, color: TOKENS.text, fontFamily: TOKENS.fonts.ui, fontSize: 12.5, fontWeight: 500, fontVariantNumeric: "tabular-nums", padding: "3px 0 4px", cursor: "pointer" }} />
            </div>
          </div>
        )}
        <div role="tablist" aria-label="Page navigation" style={{ display: "flex", flexDirection: "column", padding: "4px 0 0", flex: 1, fontFamily: TOKENS.fonts.narrow }}>
          {visiblePages.map((pg) => {
            const active = activePage === pg.id;
            return (
              <button key={pg.id} role="tab" aria-selected={active} aria-label={pg.label} onClick={() => setActivePage(pg.id)}
                onMouseEnter={(e) => { e.currentTarget.style.background = TOKENS.panel2; e.currentTarget.style.color = TOKENS.text; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = active ? TOKENS.text : TOKENS.text2; }}
                style={{
                  position: "relative", display: "flex", alignItems: "center", justifyContent: sidebarOpen ? "flex-start" : "center",
                  padding: sidebarOpen ? "6px 16px 6px 30px" : "7px 0",
                  background: "transparent", border: "none", borderRadius: 0,
                  borderLeft: `2px solid ${!sidebarOpen && active ? TOKENS.accent : "transparent"}`,
                  color: active ? TOKENS.text : TOKENS.text2, cursor: "pointer", fontSize: 14, fontWeight: active ? 700 : 500, fontFamily: TOKENS.fonts.narrow, textAlign: "left", transition: "background 0.12s, color 0.12s", width: "100%", whiteSpace: "nowrap",
                }}>
                {sidebarOpen && active && <span aria-hidden="true" style={{ position: "absolute", left: 13, top: 9, width: 5, height: 10, borderRight: `2.5px solid ${TOKENS.accent}`, borderBottom: `2.5px solid ${TOKENS.accent}`, transform: "rotate(40deg)" }} />}
                {!sidebarOpen && <span style={{ fontSize: 16, lineHeight: "18px" }}>{pg.icon}</span>}
                {sidebarOpen && <span>{pg.label}</span>}
              </button>
            );
          })}
        </div>
        <div style={{ borderTop: `1px solid ${TOKENS.line}`, padding: "4px 0 10px" }}>
          <button onClick={() => setShowSettings(true)} aria-label="League settings"
            onMouseEnter={(e) => { e.currentTarget.style.background = TOKENS.panel2; e.currentTarget.style.color = TOKENS.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = TOKENS.text3; }}
            style={{
              display: "flex", alignItems: "center", justifyContent: sidebarOpen ? "flex-start" : "center",
              padding: sidebarOpen ? "6px 16px 6px 30px" : "7px 0",
              background: "transparent", border: "none", borderRadius: 0, borderLeft: "2px solid transparent",
              color: TOKENS.text3, cursor: "pointer", fontSize: 13, fontWeight: 500, fontFamily: TOKENS.fonts.narrow, textAlign: "left", transition: "background 0.12s, color 0.12s", width: "100%", whiteSpace: "nowrap",
            }}>
            {!sidebarOpen && <span style={{ fontSize: 16, lineHeight: "18px" }}>&#9881;</span>}
            {sidebarOpen && <span>Settings</span>}
          </button>
        </div>
      </nav>
      {showSettings && <LeagueSettingsModal settings={leagueSettings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} autoExcluded={autoExcluded} allTeams={allRawTeams} />}

      {/* Main Content */}
      <div style={{ flex: 1, padding: "18px 24px 48px", maxWidth: 1400, overflowX: "hidden" }}>
        <Suspense fallback={PAGE_FALLBACK}>
          {activePage === "org" && myTeam && <OrgView data={enrichedData} team={myTeam} strength={strength} curveSettings={curveSettings} onSelectPlayer={setSelectedPlayer} />}
          {activePage === "players" && <PlayersView data={enrichedData} curveSettings={curveSettings} leagueSettings={leagueSettings} onSelectPlayer={setSelectedPlayer} />}
          {activePage === "fa" && myTeam && <FreeAgentFinder data={enrichedData} myTeam={myTeam} strength={strength} curveSettings={curveSettings} leagueSettings={leagueSettings} onSelectPlayer={setSelectedPlayer} />}
          {activePage === "waivers" && myTeam && <WaiverWireView data={enrichedData} myTeam={myTeam} strength={strength} curveSettings={curveSettings} dashMeta={dashMeta} onSelectPlayer={setSelectedPlayer} />}
          {activePage === "draft" && myTeam && <DraftBoard data={enrichedData} myTeam={myTeam} strength={strength} curveSettings={curveSettings} leagueSettings={leagueSettings} onUpdateLeagueSettings={handleUpdateLeagueSettings} onSelectPlayer={setSelectedPlayer} />}
          {activePage === "iafa" && <IAFABoard data={enrichedData} myTeam={myTeam} strength={strength} curveSettings={curveSettings} leagueSettings={leagueSettings} onSelectPlayer={setSelectedPlayer} />}
          {activePage === "dev" && <DevAnalysisView data={enrichedData} curveSettings={curveSettings} updateCurveSettings={updateCurveSettings} />}
          {activePage === "scout" && myTeam && <ScoutView data={enrichedData} myTeam={myTeam} strength={strength} strengthMode={strengthMode} setStrengthMode={setStrengthMode} curveSettings={curveSettings} onSelectPlayer={setSelectedPlayer} />}
          {activePage === "compare" && <PlayerCompareView data={enrichedData} curveSettings={curveSettings} />}
          {activePage === "r5" && myTeam && <Rule5Board data={enrichedData} myTeam={myTeam} strength={strength} curveSettings={curveSettings} leagueSettings={leagueSettings} dashMeta={dashMeta} onSelectPlayer={setSelectedPlayer} />}
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
          leagueSlug={currentLeague}
        />
      )}
    </div>
  );
}
