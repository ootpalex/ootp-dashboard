import { useState, useMemo, useEffect, Component } from "react";
import { S } from "./theme.js";
import { loadLeagueSettings } from "./utils/settings.js";
import { useLocalStorage, LeagueSlugContext } from "./hooks/useLocalStorage.js";
import { DataLoader } from "./components/shared.jsx";
import Dashboard from "./components/Dashboard.jsx";

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, textAlign: "center", color: "#e2e8f0", fontFamily: "monospace", background: "#0c1222", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#f87171" }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: "#94a3b8", maxWidth: 600 }}>{this.state.error?.message || "An unexpected error occurred"}</div>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 12, padding: "8px 20px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Try Again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Read the optional ?league=<slug> URL parameter (used by `run.py` to open
// the browser already pointed at the league that was just built). Strips
// the param from the URL after reading so a manual refresh doesn't force
// the override on every reload.
function readLeagueFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("league");
    if (!slug) return null;
    params.delete("league");
    const rest = params.toString();
    const newUrl = window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash;
    window.history.replaceState({}, "", newUrl);
    return slug;
  } catch {
    return null;
  }
}

export default function App() {
  const [rawData, setRawData] = useState(null);
  const [platoonSplits, setPlatoonSplits] = useState(null);
  const [autoLoading, setAutoLoading] = useState(true);
  const [leagues, setLeagues] = useState([]);
  const [currentLeague, setCurrentLeague] = useLocalStorage("ssb_current_league", null);
  const initSettings = useMemo(() => loadLeagueSettings(), []);
  // URL param wins on first mount — captured before the auto-load effect runs.
  const urlLeague = useMemo(() => readLeagueFromUrl(), []);

  useEffect(() => {
    let cancelled = false;
    async function autoLoad() {
      setAutoLoading(true);
      setRawData(null);
      try {
        // Multi-league path: prefer leagues.json index when available.
        let activeSlug = null;
        let leaguesList = [];
        try {
          const idxResp = await fetch("/data/leagues.json");
          if (idxResp.ok) {
            const idx = await idxResp.json();
            leaguesList = Array.isArray(idx?.leagues) ? idx.leagues : [];
          }
        } catch {
          // No index — fall through to legacy single-dashboard mode.
        }
        if (!cancelled) setLeagues(leaguesList);

        if (leaguesList.length > 0) {
          const slugs = leaguesList.map((l) => l.slug);
          // Priority: ?league= URL param (set by run.py) > persisted choice >
          // first league in the index.
          if (urlLeague && slugs.includes(urlLeague)) {
            activeSlug = urlLeague;
          } else if (slugs.includes(currentLeague)) {
            activeSlug = currentLeague;
          } else {
            activeSlug = slugs[0];
          }
          if (activeSlug !== currentLeague && !cancelled) {
            // Persist the resolved slug so reloads stay in sync.
            setCurrentLeague(activeSlug);
          }
        }

        const dashboardUrl = activeSlug
          ? `/data/${activeSlug}/dashboard.json`
          : "/data/dashboard.json";
        const resp = await fetch(dashboardUrl);
        if (!resp.ok) throw new Error(`Dashboard JSON not found at ${dashboardUrl}`);
        const dashboard = await resp.json();
        if (!cancelled) {
          setRawData({
            rawHitters: dashboard.hitters,
            rawPitchers: dashboard.pitchers,
            dashMeta: dashboard.meta,
            activeSlug,
          });
          if (dashboard.platoonSplits) setPlatoonSplits(dashboard.platoonSplits);
        }
      } catch {
        // auto-load failed — fall through to manual load UI
      } finally {
        if (!cancelled) setAutoLoading(false);
      }
    }
    autoLoad();
    return () => { cancelled = true; };
  }, [currentLeague, urlLeague]);

  if (rawData) {
    return (
      <ErrorBoundary>
        <LeagueSlugContext.Provider value={rawData.activeSlug}>
          <Dashboard
            rawHitters={rawData.rawHitters}
            rawPitchers={rawData.rawPitchers}
            platoonSplits={platoonSplits}
            dashMeta={rawData.dashMeta}
            leagues={leagues}
            currentLeague={rawData.activeSlug}
            onSelectLeague={setCurrentLeague}
          />
        </LeagueSlugContext.Provider>
      </ErrorBoundary>
    );
  }

  if (autoLoading) {
    const name = initSettings.leagueName || "SSB";
    return (
      <div style={S.loaderContainer}>
        <div style={S.loaderCard}>
          <span style={{ fontSize: 42, fontWeight: 800, letterSpacing: -2, color: "#e2e8f0" }}>{name}</span>
          <span style={{ fontSize: 14, color: "#64748b", letterSpacing: 3, textTransform: "uppercase" }}>Loading data...</span>
        </div>
      </div>
    );
  }

  return <DataLoader onDataLoaded={(rawH, rawP) => setRawData({ rawHitters: rawH, rawPitchers: rawP })} initSettings={initSettings} />;
}
