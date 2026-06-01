import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { S, FV_TIER_COLORS } from "../theme.js";
import { posColor, levelColor, warStyle, devPctColor, scoutingRatingColor } from "../theme.js";
import { fmt, fmtAge, num, paginateRows, searchFilter, orgLabel, rankSuffix } from "../utils/helpers.js";
import { genericSort, getMaxWar, getSpWar, getRpWar, passesPositionFilter, passesLevelFilter } from "../utils/accessors.js";
import { FV_TIERS, PER_PAGE, PROSPECT_SUB_TABS } from "../utils/constants.js";
import { loadProspectSettings, saveProspectSettings } from "../utils/settings.js";
import { buildProspectPool, suggestThresholds, assignFVTier, getDollarValue, calcFarmRankings } from "../utils/prospects.js";
import { Section, SortHeader, PillBtn, PositionFilter, LevelFilter, MultiSelectDropdown, TabGroup, TwoWayBadge, Pagination, NumInput } from "./shared.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";

function ProspectsView({ data, curveSettings, leagueSettings, onSelectPlayer }) {
  const [subTab, setSubTab] = useState("board");

  const iafaTag = leagueSettings?.iafaTag || "IAFA";
  const prospectPool = useMemo(() => buildProspectPool(data, iafaTag, curveSettings), [data, iafaTag, curveSettings]);

  // Initialize thresholds on first load
  const [thresholds, setThresholds] = useState(() => {
    const saved = loadProspectSettings();
    return saved?.thresholds || {};
  });
  const [dollarValues, setDollarValues] = useState(() => {
    const saved = loadProspectSettings();
    if (saved?.dollarValues) return saved.dollarValues;
    const dv = {};
    FV_TIERS.forEach((t) => { dv[t.id] = { bat: t.defaultBat, pit: t.defaultPit }; });
    return dv;
  });

  // Board filter state lifted here so FarmRankings can navigate into Board with filters.
  // Both are arrays for the new MultiSelectDropdown style.
  const [boardOrgFilter, setBoardOrgFilter] = useState([]);
  const [boardTierFilter, setBoardTierFilter] = useState([]);

  const navigateToBoard = useCallback((team, tierId) => {
    setBoardOrgFilter(team ? [team] : []);
    setBoardTierFilter(tierId ? [tierId] : []);
    setSubTab("board");
  }, []);

  // Auto-suggest thresholds on first load if none saved
  const hasAutoSuggested = useRef(false);
  useEffect(() => {
    if (hasAutoSuggested.current) return;
    if (Object.keys(thresholds).length === 0 && prospectPool.length > 0) {
      const suggested = suggestThresholds(prospectPool, data.teams.length);
      setThresholds(suggested);
      hasAutoSuggested.current = true;
    }
  }, [prospectPool, data.teams.length, thresholds]);

  // Persist settings on change
  useEffect(() => {
    if (Object.keys(thresholds).length > 0) {
      saveProspectSettings({ thresholds, dollarValues });
    }
  }, [thresholds, dollarValues]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <TabGroup label="Prospect sections" style={{ display: "flex", gap: 8 }}>
        {PROSPECT_SUB_TABS.map((tab) => (
          <PillBtn key={tab.id} active={subTab === tab.id} onClick={() => {
            if (tab.id === "farm") { setBoardOrgFilter([]); setBoardTierFilter([]); }
            setSubTab(tab.id);
          }}>
            {tab.label}
          </PillBtn>
        ))}
      </TabGroup>
      {subTab === "board" && (
        <ProspectBoard data={data} prospectPool={prospectPool} thresholds={thresholds}
          setThresholds={setThresholds} dollarValues={dollarValues} setDollarValues={setDollarValues}
          curveSettings={curveSettings} orgFilter={boardOrgFilter} setOrgFilter={setBoardOrgFilter}
          tierFilter={boardTierFilter} setTierFilter={setBoardTierFilter} onSelectPlayer={onSelectPlayer} />
      )}
      {subTab === "farm" && (
        <FarmRankings data={data} prospectPool={prospectPool} thresholds={thresholds} dollarValues={dollarValues}
          onNavigate={navigateToBoard} />
      )}
    </div>
  );
}

function ProspectBoard({ data, prospectPool, thresholds, setThresholds, dollarValues, setDollarValues, curveSettings, orgFilter, setOrgFilter, tierFilter, setTierFilter, onSelectPlayer }) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [posFilter, setPosFilter] = useState([]);
  const [levelFilter, setLevelFilter] = useState([]);
  const [sort, setSort] = useState({ col: "_fv", dir: "desc" });
  const [page, setPage] = useState(0);
  const [configOpen, setConfigOpen] = useState(false);

  // MLB WAR distribution for per-tier rarity counts (Option B in tier table).
  // Filter: lev === "MLB" AND on the 40-man roster. The on40 check excludes
  // DFA'd / limbo players (still tagged MLB-level but not on the big-league
  // squad) while keeping IL players who are officially on the roster.
  const mlbWAR = useMemo(() => {
    const isOnBigLeagueSquad = (p) => (p.meta?.lev ?? p.Lev) === "MLB" && p.meta?.on40 === true;
    const mlbH = data.hitters.filter(isOnBigLeagueSquad);
    const mlbP = data.pitchers.filter(isOnBigLeagueSquad);
    const hWAR = mlbH.map((h) => getMaxWar(h)).filter((v) => v != null);
    const pWAR = mlbP.map((p) => getSpWar(p) ?? getRpWar(p)).filter((v) => v != null);
    return [...hWAR, ...pWAR].sort((a, b) => b - a);
  }, [data]);
  const countMlbAtOrAbove = useCallback((threshold) => {
    if (threshold == null) return null;
    // Binary search for first index where WAR < threshold (array is desc)
    let lo = 0, hi = mlbWAR.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (mlbWAR[mid] >= threshold) lo = mid + 1; else hi = mid;
    }
    return lo;
  }, [mlbWAR]);

  // Tier distribution stats for config table
  const tierStats = useMemo(() => {
    const sorted = [...prospectPool].sort((a, b) => (b._fv ?? b._baseVal ?? 0) - (a._fv ?? a._baseVal ?? 0));
    const stats = {};
    let cumulative = 0;
    FV_TIERS.forEach((tier) => {
      const inTier = sorted.filter((p) => assignFVTier(p._fv ?? p._baseVal ?? 0, thresholds) === tier.id);
      cumulative += inTier.length;
      const fvs = inTier.map((p) => p._fv ?? p._baseVal ?? 0);
      const hit = inTier.filter((p) => p._poolType === "hitter").length;
      const pit = inTier.filter((p) => p._poolType === "pitcher").length;
      stats[tier.id] = {
        count: inTier.length, cumulative, hit, pit,
        minFV: fvs.length > 0 ? Math.min(...fvs) : null,
        maxFV: fvs.length > 0 ? Math.max(...fvs) : null,
      };
    });
    return stats;
  }, [prospectPool, thresholds]);

  // Pre-compute stable ranks (overall + per-org) sorted by FV desc, independent of filters
  const rankedPool = useMemo(() => {
    // Assign tiers to full pool, exclude below 35+
    const withTiers = prospectPool.map((p) => {
      const fv = p._fv ?? p._baseVal ?? 0;
      const tierId = assignFVTier(fv, thresholds);
      const dollarVal = tierId ? getDollarValue(tierId, p._poolType, dollarValues) : 0;
      return { ...p, _tierId: tierId, _dollarVal: dollarVal };
    }).filter((p) => p._tierId != null);

    // Sort by FV desc for ranking
    withTiers.sort((a, b) => (b._fv ?? b._baseVal ?? 0) - (a._fv ?? a._baseVal ?? 0));

    // Assign overall rank
    withTiers.forEach((p, i) => { p._overallRank = i + 1; });

    // Assign org rank
    const orgCounters = {};
    withTiers.forEach((p) => {
      const org = p.meta?.org ?? p.ORG ?? "-";
      orgCounters[org] = (orgCounters[org] || 0) + 1;
      p._orgRank = orgCounters[org];
    });

    return withTiers;
  }, [prospectPool, thresholds, dollarValues]);

  const displayPool = useMemo(() => {
    let rows = [...rankedPool];
    rows = searchFilter(rows, debouncedSearch);
    if (posFilter.length > 0) rows = rows.filter((r) => passesPositionFilter(r, posFilter));
    if (orgFilter.length > 0) rows = rows.filter((r) => orgFilter.includes(r.meta?.org ?? r.ORG));
    if (levelFilter.length > 0) rows = rows.filter((r) => passesLevelFilter(r, levelFilter));
    if (tierFilter.length > 0) rows = rows.filter((r) => tierFilter.includes(r._tierId));

    const { col, dir } = sort;
    genericSort(rows, col, dir, {
      _fv: (p) => p._fv ?? p._baseVal,
      _dollarVal: (p) => p._dollarVal,
      _devPct: (p) => p._devPct,
      _overallRank: (p) => p._overallRank,
      _orgRank: (p) => p._orgRank,
      _tierId: (p) => FV_TIERS.findIndex((t) => t.id === p._tierId),
    });
    return rows;
  }, [rankedPool, debouncedSearch, posFilter, orgFilter, levelFilter, tierFilter, sort]);

  const { paged, totalPages } = paginateRows(displayPool, page, PER_PAGE);

  const cfgInputStyle = { ...S.filterSelect, width: 65, padding: "3px 4px", fontSize: 11, textAlign: "right" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Config Section */}
      <Section title="Prospect Board Configuration" actions={
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setConfigOpen(!configOpen)} style={{ ...S.pillBtn, borderColor: "#334155", color: "#94a3b8", fontSize: 11 }}>
            {configOpen ? "Hide Config" : "Show Config"}
          </button>
          <button onClick={() => {
            const suggested = suggestThresholds(prospectPool, data.teams.length);
            setThresholds(suggested);
          }} style={{ ...S.pillBtn, borderColor: "#3b82f6", color: "#93c5fd", fontSize: 11 }}>
            Suggest Thresholds
          </button>
          <button onClick={() => {
            const dv = {};
            FV_TIERS.forEach((t) => { dv[t.id] = { bat: t.defaultBat, pit: t.defaultPit }; });
            setDollarValues(dv);
          }} style={{ ...S.pillBtn, borderColor: "#334155", color: "#94a3b8", fontSize: 11 }}>
            Reset $ Defaults
          </button>
        </div>
      }>
        {configOpen && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Config Table */}
            <div style={S.tableWrap}>
              <table style={S.table}>
                <thead><tr>
                  <th style={{ ...S.th, width: 50 }}>Tier</th>
                  <th style={{ ...S.th, width: 80, textAlign: "center" }}>FV ≥ Threshold</th>
                  <th style={{ ...S.th, width: 65, textAlign: "center" }}>Bat $M</th>
                  <th style={{ ...S.th, width: 65, textAlign: "center" }}>Pit $M</th>
                  <th style={{ ...S.th, width: 45, textAlign: "right" }}>Count</th>
                  <th style={{ ...S.th, width: 35, textAlign: "right" }}>H</th>
                  <th style={{ ...S.th, width: 35, textAlign: "right" }}>P</th>
                  <th style={{ ...S.th, width: 45, textAlign: "right" }}>Cum.</th>
                  <th style={{ ...S.th, width: 100 }}>FV Range</th>
                  <th style={{ ...S.th, width: 140, textAlign: "right" }} title="Current-season MLB players whose WAR is at or above this tier's FV threshold">MLB Players ≥ FV</th>
                </tr></thead>
                <tbody>
                  {FV_TIERS.map((tier, ti) => {
                    const ts = tierStats[tier.id];
                    const thresh = thresholds[tier.id];
                    const mlbCount = countMlbAtOrAbove(thresh);
                    return (
                      <tr key={tier.id} style={{ background: ti % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
                        <td style={S.td}>
                          <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700,
                            background: `${FV_TIER_COLORS[tier.id]}22`, color: FV_TIER_COLORS[tier.id], border: `1px solid ${FV_TIER_COLORS[tier.id]}44` }}>
                            {tier.label}
                          </span>
                        </td>
                        <td style={{ ...S.td, textAlign: "center" }}>
                          <input type="number" step="0.1" value={thresh ?? ""} onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v)) setThresholds((prev) => ({ ...prev, [tier.id]: v }));
                          }} style={cfgInputStyle} />
                        </td>
                        <td style={{ ...S.td, textAlign: "center" }}>
                          <input type="number" step="0.5" value={dollarValues[tier.id]?.bat ?? 0} onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v)) setDollarValues((prev) => ({ ...prev, [tier.id]: { ...prev[tier.id], bat: v } }));
                          }} style={cfgInputStyle} />
                        </td>
                        <td style={{ ...S.td, textAlign: "center" }}>
                          <input type="number" step="0.5" value={dollarValues[tier.id]?.pit ?? 0} onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v)) setDollarValues((prev) => ({ ...prev, [tier.id]: { ...prev[tier.id], pit: v } }));
                          }} style={cfgInputStyle} />
                        </td>
                        <td style={{ ...S.td, textAlign: "right", fontWeight: 600, color: ts.count > 0 ? "#e2e8f0" : "#334155" }}>{ts.count}</td>
                        <td style={{ ...S.td, textAlign: "right", color: ts.hit > 0 ? "#60a5fa" : "#334155" }}>{ts.hit}</td>
                        <td style={{ ...S.td, textAlign: "right", color: ts.pit > 0 ? "#f472b6" : "#334155" }}>{ts.pit}</td>
                        <td style={{ ...S.td, textAlign: "right", color: "#64748b" }}>{ts.cumulative}</td>
                        <td style={{ ...S.td, color: "#475569", fontSize: 11 }}>
                          {ts.count > 0 ? `${fmt(ts.minFV)}–${fmt(ts.maxFV)}` : "—"}
                        </td>
                        <td style={{ ...S.td, color: "#94a3b8", fontSize: 11, textAlign: "right" }}>
                          {mlbCount == null ? "—" : `${mlbCount} of ${mlbWAR.length}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, color: "#475569" }}>
              {prospectPool.length} total prospects across {data.teams.length} teams
            </div>
          </div>
        )}
      </Section>

      {/* Filter Bar + Table */}
      <Section title={`The Board (${prospectPool.length})`}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setPage(0); }} />
          <MultiSelectDropdown
            options={data.teams.map((t) => ({ value: t, label: t }))}
            value={orgFilter} onChange={(v) => { setOrgFilter(v); setPage(0); }}
            placeholder="All Teams" ariaLabel="Filter by team"
          />
          <LevelFilter players={prospectPool} value={levelFilter} onChange={(v) => { setLevelFilter(v); setPage(0); }} expandRookieTeams={false} />
          <MultiSelectDropdown
            options={FV_TIERS.map((t) => ({ value: t.id, label: t.label }))}
            value={tierFilter} onChange={(v) => { setTierFilter(v); setPage(0); }}
            placeholder="All Tiers" ariaLabel="Filter by tier"
          />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input type="text" placeholder="Search name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} style={S.searchInput} />
        </div>

        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead><tr>
              {[
                { key: "_overallRank", label: "Rank", w: 45 },
                { key: "_orgRank", label: "Org", w: 40 },
                { key: "_tierId", label: "FV Tier", w: 65 },
                { key: "Name", label: "Name", w: 170 },
                { key: "Age", label: "Age", w: 45 },
                { key: "_devPct", label: "Dev%", w: 48 },
                { key: "POS", label: "POS", w: 48 },
                { key: "_bestPos", label: "Best", w: 48 },
                { key: "ORG", label: "Team", w: 130 },
                { key: "Lev", label: "Lvl", w: 45 },
                { key: "_fv", label: "FV", w: 60 },
                { key: "_currentVal", label: "WAR", w: 65 },
                { key: "_baseVal", label: "WAR P", w: 65 },
                { key: "_dollarVal", label: "$ Val", w: 55 },
              ].map(({ key, label, w }) => (
                <SortHeader key={key} label={label} width={w} sortCol={sort.col} sortDir={sort.dir} colKey={key}
                  onClick={() => setSort((prev) => ({ col: key, dir: prev.col === key && prev.dir === "desc" ? "asc" : "desc" }))} />
              ))}
            </tr></thead>
            <tbody>
              {paged.map((p, i) => (
                  <tr key={p._uid || (p.ID + "-" + i)} style={{ background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
                    <td style={{ ...S.td, color: "#e2e8f0", fontWeight: 700 }}>{p._overallRank}</td>
                    <td style={{ ...S.td, color: "#64748b" }}>{p._orgRank}</td>
                    <td style={S.td}>
                      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700,
                        background: `${FV_TIER_COLORS[p._tierId]}22`, color: FV_TIER_COLORS[p._tierId], border: `1px solid ${FV_TIER_COLORS[p._tierId]}44` }}>
                        {p._tierId}
                      </span>
                    </td>
                    <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 170, cursor: "pointer" }}
                        onClick={() => onSelectPlayer?.(p)}>{p.meta?.name ?? p.Name}<TwoWayBadge player={p} /></td>
                    <td style={S.td}>{fmtAge(p._age)}</td>
                    <td style={{ ...S.td, color: p._devPct != null ? devPctColor(p._devPct) : "#475569", fontWeight: p._devPct != null ? 600 : 400 }}>
                      {p._devPct != null ? rankSuffix(Math.round(p._devPct * 100)) : "—"}
                    </td>
                    <td style={{ ...S.td, color: posColor(p.meta?.pos ?? p.POS) }}>{p.meta?.pos ?? p.POS}</td>
                    <td style={{ ...S.td, color: posColor(p._bestPos?.replace("*", "")) }}>{p._bestPos || "—"}</td>
                    <td style={S.td}>{orgLabel(p)}</td>
                    <td style={{ ...S.td, color: levelColor(p.meta?.lev ?? p.Lev) }}>{p.meta?.lev ?? p.Lev ?? "—"}</td>
                    <td style={{ ...S.td, ...warStyle(p._fv ?? p._baseVal) }}>{fmt(p._fv ?? p._baseVal)}</td>
                    <td style={{ ...S.td, ...warStyle(p._currentVal) }}>{fmt(p._currentValDisplay ?? p._currentVal)}</td>
                    <td style={{ ...S.td, ...warStyle(p._baseVal) }}>{fmt(p._baseValDisplay ?? p._baseVal)}</td>
                    <td style={{ ...S.td, color: "#fbbf24", fontWeight: 600 }}>{p._dollarVal > 0 ? `$${fmt(p._dollarVal, 1)}M` : "—"}</td>
                  </tr>
              ))}
              {paged.length === 0 && <tr><td colSpan={14} style={{ ...S.td, textAlign: "center", color: "#475569" }}>No prospects found</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={displayPool.length} onPrev={() => setPage(Math.max(0, page - 1))} onNext={() => setPage(Math.min(totalPages - 1, page + 1))} />
      </Section>
    </div>
  );
}

function FarmStackedTooltip({ active, payload, label, playersByTeamTier, hoveredTier }) {
  if (!active || !payload || !payload.length || !hoveredTier) return null;
  const tierId = hoveredTier;
  const players = playersByTeamTier?.[label]?.[tierId] || [];
  const tierEntry = payload.find((p) => p.dataKey === `tier_${tierId}`);
  const tierValue = tierEntry?.value ?? 0;
  if (tierValue === 0 && players.length === 0) return null;
  return (
    <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "10px 14px", fontSize: 11, color: "#e2e8f0", maxWidth: 280 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 8, fontSize: 10, fontWeight: 700,
          background: `${FV_TIER_COLORS[tierId]}22`, color: FV_TIER_COLORS[tierId], border: `1px solid ${FV_TIER_COLORS[tierId]}44` }}>
          FV {tierId}
        </span>
        <span style={{ color: "#fbbf24", fontWeight: 600 }}>${fmt(tierValue, 1)}M</span>
        <span style={{ color: "#475569" }}>{players.length} player{players.length !== 1 ? "s" : ""}</span>
      </div>
      {players.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 6, color: "#94a3b8", paddingLeft: 4 }}>
          <span style={{ color: "#e2e8f0", fontWeight: 500, minWidth: 110 }}>{p.name}</span>
          <span style={{ color: posColor(p.pos), minWidth: 24 }}>{p.pos}</span>
          <span style={{ color: "#475569" }}>{fmt(p.fv)}</span>
        </div>
      ))}
    </div>
  );
}

function FarmRankings({ data, prospectPool, thresholds, dollarValues, onNavigate }) {
  const [sort, setSort] = useState({ col: "totalValue", dir: "desc" });
  const [hoveredTier, setHoveredTier] = useState(null);

  const rankings = useMemo(() => {
    return calcFarmRankings(prospectPool, thresholds, dollarValues, data.teams);
  }, [prospectPool, thresholds, dollarValues, data.teams]);

  // Build player lists by team+tier and stacked chart data
  const { chartData, playersByTeamTier } = useMemo(() => {
    // Build lookup: team -> tier -> player list
    const lookup = {};
    data.teams.forEach((t) => { lookup[t] = {}; FV_TIERS.forEach((tier) => { lookup[t][tier.id] = []; }); });
    prospectPool.forEach((p) => {
      const org = p.meta?.org ?? p.ORG;
      if (!org || org === "-" || org === "0" || !lookup[org]) return;
      const fv = p._fv ?? p._baseVal ?? 0;
      const tierId = assignFVTier(fv, thresholds);
      if (!tierId) return;
      lookup[org][tierId].push({ name: p.meta?.name ?? p.Name, pos: p._bestPos || p.meta?.pos || p.POS, fv, type: p._poolType });
    });
    // Sort players within each tier by FV desc
    Object.values(lookup).forEach((tiers) => {
      Object.values(tiers).forEach((arr) => arr.sort((a, b) => b.fv - a.fv));
    });

    // Build chart data sorted by total value desc
    const sorted = [...rankings].sort((a, b) => b.totalValue - a.totalValue);
    const cd = sorted.map((r) => {
      const row = { team: r.team };
      FV_TIERS.forEach((t) => {
        // Sum dollar values for this team+tier
        const players = lookup[r.team]?.[t.id] || [];
        let tierVal = 0;
        players.forEach((p) => {
          tierVal += getDollarValue(t.id, p.type, dollarValues);
        });
        row[`tier_${t.id}`] = Math.round(tierVal * 10) / 10;
      });
      return row;
    });
    return { chartData: cd, playersByTeamTier: lookup };
  }, [rankings, prospectPool, thresholds, dollarValues, data.teams]);

  const sortedRankings = useMemo(() => {
    const rows = [...rankings];
    const { col, dir } = sort;
    rows.sort((a, b) => {
      let va, vb;
      if (col === "team") { va = a.team; vb = b.team; }
      else if (col.startsWith("tier_")) {
        const tid = col.replace("tier_", "");
        va = a.tierCounts[tid] || 0; vb = b.tierCounts[tid] || 0;
      }
      else { va = a[col]; vb = b[col]; }
      if (typeof va === "string") return dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      return dir === "asc" ? (va ?? 0) - (vb ?? 0) : (vb ?? 0) - (va ?? 0);
    });
    return rows;
  }, [rankings, sort]);

  const doSort = (col) => setSort((prev) => ({ col, dir: prev.col === col && prev.dir === "desc" ? "asc" : "desc" }));
  const clickStyle = { cursor: "pointer", textDecoration: "none", borderBottom: "1px dashed currentColor" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Rankings Table */}
      <Section title="Farm System Rankings">
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead><tr>
              {[
                { key: "rank", label: "#", w: 35 },
                { key: "team", label: "Team", w: 110 },
                { key: "totalValue", label: "Value", w: 65 },
                { key: "count", label: "#P", w: 35 },
                { key: "avgValue", label: "Avg", w: 50 },
                ...FV_TIERS.map((t) => ({ key: `tier_${t.id}`, label: t.label, w: 35 })),
                { key: "ceiling", label: "Ceil", w: 40 },
                { key: "floor", label: "Floor", w: 42 },
                { key: "batting", label: "Bat", w: 38 },
                { key: "pitching", label: "Pit", w: 38 },
                { key: "report", label: "Scouting Report", w: 260 },
              ].map(({ key, label, w }) => (
                <SortHeader key={key} label={label} width={w} sortCol={sort.col} sortDir={sort.dir} colKey={key}
                  onClick={() => doSort(key)} />
              ))}
            </tr></thead>
            <tbody>
              {sortedRankings.map((r, i) => (
                <tr key={r.team} style={{ background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
                  <td style={{ ...S.td, color: "#475569", fontWeight: 600 }}>{r.rank}</td>
                  <td style={{ ...S.td, fontWeight: 600, color: "#93c5fd" }}>
                    <span style={clickStyle} onClick={() => onNavigate(r.team, null)}>{r.team}</span>
                  </td>
                  <td style={{ ...S.td, color: "#fbbf24", fontWeight: 700 }}>${fmt(r.totalValue, 1)}M</td>
                  <td style={S.td}>{r.count}</td>
                  <td style={{ ...S.td, color: "#94a3b8" }}>${fmt(r.avgValue, 1)}</td>
                  {FV_TIERS.map((t) => {
                    const cnt = r.tierCounts[t.id] || 0;
                    return (
                      <td key={t.id} style={{ ...S.td, color: cnt > 0 ? FV_TIER_COLORS[t.id] : "#334155", fontWeight: cnt > 0 ? 600 : 400 }}>
                        {cnt > 0 ? (
                          <span style={clickStyle} onClick={() => onNavigate(r.team, t.id)}>{cnt}</span>
                        ) : 0}
                      </td>
                    );
                  })}
                  <td style={{ ...S.td, color: scoutingRatingColor(r.ceiling), fontWeight: 600 }}>{r.ceiling}</td>
                  <td style={{ ...S.td, color: scoutingRatingColor(r.floor), fontWeight: 600 }}>{r.floor}</td>
                  <td style={{ ...S.td, color: scoutingRatingColor(r.batting), fontWeight: 600 }}>{r.batting}</td>
                  <td style={{ ...S.td, color: scoutingRatingColor(r.pitching), fontWeight: 600 }}>{r.pitching}</td>
                  <td style={{ ...S.td, fontSize: 11, color: "#94a3b8", whiteSpace: "normal", maxWidth: 260 }}>{r.report}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Stacked Bar Chart */}
      <Section title="Farm System Values">
        <div style={{ width: "100%", height: 420, overflowX: "auto" }}>
          <div style={{ width: Math.max(chartData.length * 50, 600), height: 400 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="team" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-45} textAnchor="end" interval={0} height={60} />
                <YAxis tick={{ fill: "#64748b", fontSize: 11 }} label={{ value: "System Value ($M)", angle: -90, position: "insideLeft", fill: "#475569", fontSize: 11 }} />
                <Tooltip content={<FarmStackedTooltip playersByTeamTier={playersByTeamTier} hoveredTier={hoveredTier} />} />
                {[...FV_TIERS].reverse().map((t) => (
                  <Bar key={t.id} dataKey={`tier_${t.id}`} stackId="value" fill={FV_TIER_COLORS[t.id]} name={`FV ${t.label}`}
                    onMouseEnter={() => setHoveredTier(t.id)} onMouseLeave={() => setHoveredTier(null)} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
          {FV_TIERS.map((t) => (
            <span key={t.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: FV_TIER_COLORS[t.id], display: "inline-block" }} />
              <span style={{ color: "#94a3b8" }}>{t.label}</span>
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}

export default ProspectsView;
