import { useState, useMemo, useCallback, useEffect } from "react";
import * as Papa from "papaparse";
import { S } from "../theme.js";
import { posColor, proneColor, waaStyle, intangibleColor, devPctColor, gradeStyle, zToColor } from "../theme.js";
import { fmt, fmtAge, num, paginateRows } from "../utils/helpers.js";
import { PER_PAGE, CAP_GROUPS } from "../utils/constants.js";
import { getStatsplusBase } from "../utils/settings.js";
import { calcOrgNeed, calcPositionalScarcity } from "../utils/strength.js";
import { buildBoardPool, computeDevPercentilesMap, buildDisplayPool } from "./boardUtils.js";
import { Section, SortHeader, PillBtn, PositionFilter, Toggle, TwoWayBadge, Pagination } from "./shared.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";

async function fetchDraftData(statsplusBase) {
  try {
    const base = statsplusBase || getStatsplusBase();
    const resp = await fetch(`${base}/draftv2/`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
    return { data: parsed.data, error: null };
  } catch (e) {
    return { data: null, error: `Failed to fetch: ${e.message}. If CORS blocked, use the manual paste option.` };
  }
}

function DraftBoard({ data, myTeam, strength, curveSettings, leagueSettings, onSelectPlayer }) {
  const [draftedPlayers, setDraftedPlayers] = useState([]);
  const [apiError, setApiError] = useState(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState(null);
  const [manualCSV, setManualCSV] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [toggles, setToggles] = useState({ orgNeed: false, scarcity: false, devAdj: false, defSpectrum: false });
  const setToggle = (key) => setToggles((t) => ({ ...t, [key]: !t[key] }));
  const [totalPicks, setTotalPicks] = useState(25);
  const [caps, setCaps] = useState(() => { const c = {}; CAP_GROUPS.forEach((g) => { c[g.id] = Math.round(g.pct * 25); }); return c; });
  useEffect(() => { setCaps(() => { const c = {}; CAP_GROUPS.forEach((g) => { c[g.id] = Math.max(1, Math.round(g.pct * totalPicks)); }); return c; }); }, [totalPicks]);
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState([]);
  const [sort, setSort] = useState({ col: "_rank", dir: "desc" });
  const [page, setPage] = useState(0);

  // Draft demands
  const demandsOn = leagueSettings?.draftDemands || false;
  const budget = leagueSettings?.draftBudget || 0;

  // Manual "I Drafted" tracking
  const [myManualPicks, setMyManualPicks] = useState([]);
  const addManualPick = (player) => setMyManualPicks((prev) => [...prev, player]);
  const removeManualPick = (id) => setMyManualPicks((prev) => prev.filter((p) => p.ID !== id));

  // Detect available draft classes from Manual column
  const draftClasses = useMemo(() => {
    const classes = new Set();
    [...data.hitters, ...data.pitchers].forEach((p) => {
      const m = (p.meta?.source ?? p.meta?.manual ?? p.Manual ?? "").trim();
      if (m && m.toLowerCase().includes("draft")) {
        classes.add(m);
      }
    });
    return [...classes].sort();
  }, [data]);

  const [selectedClass, setSelectedClass] = useState(() => draftClasses[0] || "");
  useEffect(() => { if (!selectedClass && draftClasses.length > 0) setSelectedClass(draftClasses[0]); }, [draftClasses]);

  const fetchDraft = useCallback(async () => {
    setApiLoading(true); setApiError(null);
    const { data: d, error } = await fetchDraftData(getStatsplusBase(leagueSettings));
    if (error) { setApiError(error); } else if (d) { setDraftedPlayers(d); setLastFetch(new Date()); }
    setApiLoading(false);
  }, [leagueSettings]);

  const handleManualPaste = () => {
    try {
      const parsed = Papa.parse(manualCSV.trim(), { header: true, skipEmptyLines: true });
      if (parsed.data.length === 0) { setApiError("No data rows found in pasted CSV"); return; }
      const hasId = parsed.data[0].ID != null || parsed.data[0].id != null;
      if (!hasId) { setApiError("CSV must have an ID column to match players"); return; }
      setDraftedPlayers(parsed.data); setLastFetch(new Date()); setApiError(null); setShowManual(false);
    } catch { setApiError("Failed to parse pasted data"); }
  };

  const draftedIds = useMemo(() => new Set(draftedPlayers.map((d) => String(d.ID || d.id))), [draftedPlayers]);
  const manualPickIds = useMemo(() => new Set(myManualPicks.map((p) => String(p.ID))), [myManualPicks]);

  // My picks from API
  const myApiPicks = useMemo(() => {
    if (!myTeam || draftedPlayers.length === 0) return [];
    return draftedPlayers.filter((d) => {
      const t = d.Team || d.team || "";
      return t === myTeam || t.includes(myTeam);
    });
  }, [draftedPlayers, myTeam]);

  // All my picks (API + manual)
  const allMyPicks = useMemo(() => [...myApiPicks, ...myManualPicks], [myApiPicks, myManualPicks]);

  // Draft demand spending
  const spent = useMemo(() => {
    if (!demandsOn) return 0;
    return allMyPicks.reduce((sum, p) => sum + (num(p.meta?.dem ?? p["DEM Sort"]) || 0), 0);
  }, [allMyPicks, demandsOn]);
  const remaining = budget - spent;

  const orgNeed = useMemo(() => myTeam ? calcOrgNeed(myTeam, strength) : null, [myTeam, strength]);

  // Build draft pool from selected draft class
  const fullPool = useMemo(() => {
    const matchesDraft = (p) => {
      const m = (p.meta?.source ?? p.meta?.manual ?? p.Manual ?? "").trim();
      if (selectedClass === "__ALL__") return m.toLowerCase().includes("draft");
      if (selectedClass) return m === selectedClass;
      return m.toLowerCase().includes("draft");
    };
    const demFields = (p) => ({ _demSort: p.meta?.demSort ?? num(p["DEM Sort"]) });
    return buildBoardPool(data, matchesDraft, matchesDraft, demFields);
  }, [data, selectedClass]);

  // Available pool (not yet drafted)
  const availablePool = useMemo(() => fullPool.filter((p) => !draftedIds.has(String(p.ID))), [fullPool, draftedIds]);

  const scarcity = useMemo(() => toggles.scarcity ? calcPositionalScarcity(availablePool) : null, [availablePool, toggles.scarcity]);

  // Precompute dev percentiles against full league pool (always computed for Dev% column)
  // Hitters use BatR wtd (batting runs only, excludes defense/baserunning which lack potential ratings)
  const devPercentiles = useMemo(() => computeDevPercentilesMap(availablePool, data), [availablePool, data.hitters, data.pitchers]);

  // Cap status from allMyPicks
  const capStatus = useMemo(() => {
    const status = {};
    CAP_GROUPS.forEach((g) => {
      const picked = allMyPicks.filter((d) => {
        const pos = d.POS || d.Position || "";
        return g.positions.includes(pos);
      }).length;
      status[g.id] = { picked, cap: caps[g.id], pct: caps[g.id] > 0 ? picked / caps[g.id] : 0 };
    });
    return status;
  }, [allMyPicks, caps]);

  // Apply rankings + sort
  const debouncedSearch = useDebouncedValue(search);
  const displayPool = useMemo(() =>
    buildDisplayPool(availablePool, debouncedSearch, posFilter, sort, toggles, orgNeed, scarcity, devPercentiles, curveSettings),
    [availablePool, debouncedSearch, posFilter, sort, toggles, orgNeed, scarcity, devPercentiles, curveSettings]);

  const { paged, totalPages } = paginateRows(displayPool, page, PER_PAGE);
  const anyToggle = toggles.orgNeed || toggles.scarcity || toggles.devAdj || toggles.defSpectrum;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Draft Class Selector */}
      <Section title="Draft Class">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {draftClasses.map((dc) => (
            <PillBtn key={dc} active={selectedClass === dc} onClick={() => { setSelectedClass(dc); setPage(0); setMyManualPicks([]); }}>
              {dc}
            </PillBtn>
          ))}
          <PillBtn active={selectedClass === "__ALL__"} onClick={() => { setSelectedClass("__ALL__"); setPage(0); setMyManualPicks([]); }}>
            All Draft Eligible
          </PillBtn>
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
          {fullPool.length} players in {selectedClass === "__ALL__" ? "full draft pool" : `"${selectedClass}"`}
        </div>
      </Section>

      {/* API Status */}
      <Section title="StatsPlus Draft Feed" actions={
        <>
          <button onClick={fetchDraft} disabled={apiLoading} style={{ ...S.pillBtn, borderColor: "#3b82f6", color: "#93c5fd", background: "rgba(59,130,246,0.15)" }}>
            {apiLoading ? "Fetching..." : "🔄 Refresh"}
          </button>
          <button onClick={() => setShowManual(!showManual)} style={{ ...S.pillBtn, borderColor: "#334155", color: "#64748b" }}>
            📋 Paste CSV
          </button>
        </>
      }>
        {apiError && <div style={{ ...S.errorBox, marginBottom: 12 }}>{apiError}</div>}
        {showManual && (
          <div style={{ marginBottom: 12 }}>
            <textarea value={manualCSV} onChange={(e) => setManualCSV(e.target.value)} placeholder="Paste /draftv2 CSV here..." style={{ width: "100%", height: 80, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: 8, fontSize: 11, fontFamily: "inherit", resize: "vertical" }} />
            <button onClick={handleManualPaste} style={{ ...S.pillBtn, borderColor: "#22c55e", color: "#86efac", marginTop: 6 }}>Parse</button>
          </div>
        )}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "#94a3b8" }}>
          <span>Drafted: <strong style={{ color: "#e2e8f0" }}>{draftedPlayers.length}</strong></span>
          <span>Available: <strong style={{ color: "#e2e8f0" }}>{availablePool.length}</strong></span>
          <span>My picks: <strong style={{ color: "#e2e8f0" }}>{allMyPicks.length}</strong></span>
          {lastFetch && <span>Updated: {lastFetch.toLocaleTimeString()}</span>}
        </div>
        {demandsOn && budget > 0 && (() => {
          const pct = budget > 0 ? Math.max(0, remaining / budget) : 1;
          const barColor = pct > 0.5 ? "#22c55e" : pct > 0.2 ? "#eab308" : "#ef4444";
          return (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                <span style={{ color: "#94a3b8" }}>Budget: <strong style={{ color: barColor }}>${remaining.toLocaleString()}</strong> remaining</span>
                <span style={{ color: "#64748b" }}>${spent.toLocaleString()} / ${budget.toLocaleString()}</span>
              </div>
              <div style={{ height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct * 100}%`, background: barColor, borderRadius: 3, transition: "width 0.3s" }} />
              </div>
            </div>
          );
        })()}
      </Section>

      {/* My Draft Class */}
      {allMyPicks.length > 0 && (
        <Section title={`My Draft Class (${allMyPicks.length} picks)`}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {allMyPicks.map((p, i) => {
              const isManual = manualPickIds.has(String(p.ID));
              return (
                <div key={i} style={{ background: "rgba(59,130,246,0.1)", border: "1px solid #1e3a5f", borderRadius: 6, padding: "4px 8px", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ color: posColor(p.Position || p.meta?.pos || p.POS), fontWeight: 600 }}>{p.Position || p.meta?.pos || p.POS}</span>
                  <span style={{ color: "#e2e8f0" }}>{p["Player Name"] || p.meta?.name || p.Name}</span>
                  {demandsOn && (p.meta?.dem ?? p.DEM) && (p.meta?.dem ?? p.DEM) !== "-" && <span style={{ color: "#94a3b8" }}>{p.meta?.dem ?? p.DEM}</span>}
                  {p.Round && <span style={{ color: "#475569" }}>R{p.Round}{String(p.Supplemental) === "1" ? "s" : ""}.{p["Pick In Round"] || "?"}</span>}
                  {isManual && <button onClick={() => removeManualPick(p.ID)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 10, padding: "0 2px" }}>✕</button>}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Position Caps + Smart Rank side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <Section title="Position Caps">
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>Total picks:</span>
            <input type="number" value={totalPicks} onChange={(e) => setTotalPicks(Math.max(1, parseInt(e.target.value) || 1))} style={{ ...S.searchInput, width: 60, textAlign: "center" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {CAP_GROUPS.map((g) => {
              const s = capStatus[g.id] || { picked: 0, cap: 0, pct: 0 };
              const atCap = s.picked >= s.cap;
              const nearCap = s.pct >= 0.75 && !atCap;
              return (
                <div key={g.id} style={{ background: atCap ? "rgba(239,68,68,0.1)" : nearCap ? "rgba(234,179,8,0.1)" : "rgba(15,23,42,0.4)", border: `1px solid ${atCap ? "#dc2626" : nearCap ? "#ca8a04" : "#1e293b"}`, borderRadius: 6, padding: "6px 8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>{g.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: atCap ? "#f87171" : nearCap ? "#fbbf24" : "#86efac" }}>{s.picked}/{s.cap}</span>
                  </div>
                  <input type="number" value={caps[g.id]} onChange={(e) => setCaps((c) => ({ ...c, [g.id]: Math.max(0, parseInt(e.target.value) || 0) }))} style={{ ...S.searchInput, width: "100%", marginTop: 4, textAlign: "center", fontSize: 10, padding: "2px 4px" }} />
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Smart Rank Adjustments">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Toggle label="Org Positional Need" description="Boost players at your org's weak positions" checked={toggles.orgNeed} onChange={() => setToggle("orgNeed")} />
            <Toggle label="Positional Scarcity (VBD)" description="Boost positions with steep talent drop-offs" checked={toggles.scarcity} onChange={() => setToggle("scarcity")} />
            <Toggle label="Future Value" description="Risk-adjusted future value rating" checked={toggles.devAdj} onChange={() => setToggle("devAdj")} />
            <Toggle label="Defensive Spectrum" description="Premium for C/SS/CF, discount for 1B/DH" checked={toggles.defSpectrum} onChange={() => setToggle("defSpectrum")} />
          </div>
        </Section>
      </div>

      {/* Draft Board Table */}
      <Section title="Draft Board">
        <div style={{ marginBottom: 12 }}>
          <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setPage(0); }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input type="text" placeholder="Search name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} style={S.searchInput} />
          <button onClick={() => {
            const seen = new Set();
            const top500 = [];
            for (const p of displayPool) {
              if (!seen.has(p.ID)) { seen.add(p.ID); top500.push(p); }
              if (top500.length >= 500) break;
            }
            const csv = "ID\n" + top500.map(p => p.ID).join("\n");
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = "draft_list.csv"; a.click();
            URL.revokeObjectURL(url);
          }} style={{ ...S.pillBtn, borderColor: "#22c55e", color: "#86efac", background: "rgba(34,197,94,0.10)" }}>Export Top 500</button>
        </div>

        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead><tr>
              <th style={{ ...S.th, width: 40 }}></th>
              {[
                { key: "_rank", label: anyToggle ? "Smart" : "WAA P", w: 70 },
                { key: "Name", label: "Name", w: 170 },
                { key: "Age", label: "Age", w: 45 },
                { key: "_devPct", label: "Dev%", w: 48 },
                { key: "POS", label: "POS", w: 48 },
                { key: "_bestPos", label: "Best", w: 48 },
                ...(anyToggle ? [{ key: "_baseVal", label: "Raw", w: 60 }] : []),
                ...(demandsOn ? [{ key: "_demSort", label: "DEM", w: 75 }] : []),
                { key: "Prone", label: "Prone", w: 65 },
                { key: "_intangibles", label: "INTS", w: 45 },
                { key: "INT", label: "INT", w: 32 },
                { key: "WE", label: "WE", w: 32 },
                { key: "LEA", label: "LEA", w: 32 },
              ].map(({ key, label, w }) => (
                <SortHeader key={key} label={label} width={w} sortCol={sort.col} sortDir={sort.dir} colKey={key} onClick={() => setSort((prev) => ({ col: key, dir: prev.col === key && prev.dir === "desc" ? "asc" : "desc" }))} />
              ))}
            </tr></thead>
            <tbody>
              {paged.map((p, i) => {
                const isManualPick = manualPickIds.has(String(p.ID));
                const dpct = devPercentiles.get(String(p.ID));
                const showDevPct = p._age != null && p._age < curveSettings.maxCurrentAge;
                return (
                  <tr key={p.ID + "-" + i} style={{ background: isManualPick ? "rgba(59,130,246,0.08)" : i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
                    <td style={S.td}>
                      {!isManualPick ? (
                        <button onClick={() => addManualPick(p)} title="I Drafted This Player" style={{ background: "none", border: "1px solid #334155", borderRadius: 4, color: "#64748b", cursor: "pointer", fontSize: 10, padding: "2px 4px", lineHeight: 1 }}>+</button>
                      ) : (
                        <span style={{ color: "#3b82f6", fontSize: 12 }}>★</span>
                      )}
                    </td>
                    <td style={{ ...S.td, ...waaStyle(p._rank), fontWeight: 700 }}>{fmt(anyToggle ? p._rank : (p._baseValDisplay ?? p._baseVal))}</td>
                    <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 170, cursor: "pointer" }}
                        onClick={() => onSelectPlayer?.(p)}>
                      {p.meta?.name ?? p.Name}<TwoWayBadge player={p} />
                      {isManualPick && <span style={{ color: "#3b82f6", marginLeft: 6, fontSize: 9 }}>DRAFTED</span>}
                    </td>
                    <td style={S.td}>{fmtAge(p._age)}</td>
                    <td style={{ ...S.td, color: showDevPct && dpct != null ? devPctColor(dpct) : "#475569", fontWeight: showDevPct && dpct != null ? 600 : 400 }}>{showDevPct && dpct != null ? Math.round(dpct * 100) + "th" : "—"}</td>
                    <td style={{ ...S.td, color: posColor(p.meta?.pos ?? p.POS) }}>{p.meta?.pos ?? p.POS}</td>
                    <td style={{ ...S.td, color: posColor(p._bestPos?.replace("*", "")) }}>{p._bestPos || "—"}</td>
                    {anyToggle && <td style={{ ...S.td, ...waaStyle(p._baseVal) }}>{fmt(p._baseValDisplay ?? p._baseVal)}</td>}
                    {demandsOn && <td style={{ ...S.td, color: "#94a3b8" }}>{(p.meta?.dem ?? p.DEM) && (p.meta?.dem ?? p.DEM) !== "-" ? (p.meta?.dem ?? p.DEM) : "—"}</td>}
                    <td style={{ ...S.td, color: proneColor(p.meta?.prone ?? p.Prone) }}>{p.meta?.prone ?? p.Prone ?? "—"}</td>
                    <td style={{ ...S.td, ...gradeStyle(p._intangibles), fontWeight: 700 }}>{p._intangibles ?? "—"}</td>
                    <td style={{ ...S.td, color: intangibleColor(p.meta?.int ?? p.INT) }}>{(p.meta?.int ?? p.INT) || "—"}</td>
                    <td style={{ ...S.td, color: intangibleColor(p.meta?.we ?? p.WE) }}>{(p.meta?.we ?? p.WE) || "—"}</td>
                    <td style={{ ...S.td, color: intangibleColor(p.meta?.lea ?? p.LEA) }}>{(p.meta?.lea ?? p.LEA) || "—"}</td>
                  </tr>
                );
              })}
              {paged.length === 0 && <tr><td colSpan={12 + (anyToggle ? 1 : 0) + (demandsOn ? 1 : 0)} style={{ ...S.td, textAlign: "center", color: "#475569" }}>No players found</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={displayPool.length} onPrev={() => setPage(Math.max(0, page - 1))} onNext={() => setPage(Math.min(totalPages - 1, page + 1))} />
      </Section>
    </div>
  );
}

export { fetchDraftData };
export default DraftBoard;
